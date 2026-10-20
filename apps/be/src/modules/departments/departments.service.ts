import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  Agent as AgentContract,
  Department as DepartmentContract,
  Member as MemberContract,
} from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects } from '../../common/utils';
import { AgentsService } from '../agents/agents.service';
import type { UpdateAgentDto } from '../agents/dto/agent.dto';
import { AuditService } from '../audit/audit.service';
import { Room } from '../chat/entities/room.entity';
import { lockRooms } from '../chat/room-access';
import { EventsService } from '../events';
import { Member } from '../workspace/entities/member.entity';
import { toMember } from '../workspace/workspace.mapper';
import { findLiveDepartment, joinDepartmentRoom } from './department-access';
import { departmentRoomSlug, firstFreeRoomName } from './department-slug.util';
import {
  CreateDepartmentDto,
  ReorderDepartmentsDto,
  SetDepartmentDto,
  SetMemberTitleDto,
  UpdateDepartmentDto,
} from './dto/department.dto';
import { Department } from './entities/department.entity';

const PG_UNIQUE_VIOLATION = '23505';
const NAME_UNIQUE_INDEX = 'UQ_departments_workspace_name_ci';

const toDepartment = (row: Department): DepartmentContract => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  rank: row.rank,
  roomId: row.roomId,
});

/**
 * Departments of a workspace and who belongs to them. Every command takes the rooms lock first
 * (name uniqueness, room creation and deletion all serialise on it), writes and audits in one
 * transaction, and publishes its events only after the commit.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
  ) {}

  async list(workspaceId: string): Promise<DepartmentContract[]> {
    const rows = await this.dataSource.getRepository(Department).find({
      where: { workspaceId },
      order: { rank: 'ASC', name: 'ASC', id: 'ASC' },
    });
    return rows.map(toDepartment);
  }

  /** Creates the department and its public channel; the caller owns the channel. */
  async create(auth: AuthContext, dto: CreateDepartmentDto): Promise<DepartmentContract> {
    return this.named(() =>
      transactionWithEffects(this.dataSource, async (manager, effects) => {
        await lockRooms(manager, auth.workspaceId);
        await this.assertNameFree(manager, auth.workspaceId, dto.name, null);
        const [{ next }] = returnedRows<{ next: number }>(
          await manager.query(
            `SELECT coalesce(max(rank) + 1, 0)::int AS next FROM departments
             WHERE workspace_id = $1 AND deleted_at IS NULL`,
            [auth.workspaceId],
          ),
        );
        const room = await this.createRoom(manager, auth, dto.name);
        const row = await manager.save(
          manager.create(Department, {
            workspaceId: auth.workspaceId,
            name: dto.name,
            icon: dto.icon ?? 'users',
            rank: next,
            roomId: room.id,
            templateId: null,
          }),
        );
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'department.created',
            targetType: 'department',
            targetId: row.id,
            meta: { name: row.name, icon: row.icon, roomId: room.id },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => {
          this.events.publish(auth.workspaceId, { type: 'departments.changed' });
          this.events.publish(auth.workspaceId, { type: 'rooms.changed' });
        });
        return toDepartment(row);
      }),
    );
  }

  /** The room keeps its name: people already know the channel by it. */
  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateDepartmentDto,
  ): Promise<DepartmentContract> {
    return this.named(() =>
      transactionWithEffects(this.dataSource, async (manager, effects) => {
        await lockRooms(manager, auth.workspaceId);
        const row = await findLiveDepartment(manager, auth.workspaceId, id);
        const changes: Partial<Pick<Department, 'name' | 'icon'>> = {};
        if (dto.name !== undefined && dto.name !== row.name) {
          await this.assertNameFree(manager, auth.workspaceId, dto.name, row.id);
          changes.name = dto.name;
        }
        if (dto.icon !== undefined && dto.icon !== row.icon) changes.icon = dto.icon;
        if (Object.keys(changes).length > 0) {
          const before = { name: row.name, icon: row.icon };
          await manager.update(Department, { id: row.id }, changes);
          Object.assign(row, changes);
          await this.audit.record(
            {
              workspaceId: auth.workspaceId,
              actorMemberId: auth.memberId,
              action: 'department.updated',
              targetType: 'department',
              targetId: row.id,
              meta: { from: before, to: { name: row.name, icon: row.icon } },
              ip: auth.ip,
            },
            manager,
          );
          effects.push(() =>
            this.events.publish(auth.workspaceId, { type: 'departments.changed' }),
          );
        }
        return toDepartment(row);
      }),
    );
  }

  /** `ids` must be exactly the live departments; their ranks become 0..n-1 in that order. */
  async reorder(auth: AuthContext, dto: ReorderDepartmentsDto): Promise<DepartmentContract[]> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      await lockRooms(manager, auth.workspaceId);
      const live = await manager.find(Department, {
        where: { workspaceId: auth.workspaceId },
        order: { rank: 'ASC', name: 'ASC', id: 'ASC' },
      });
      const wanted = new Set(dto.ids);
      if (
        wanted.size !== dto.ids.length ||
        dto.ids.length !== live.length ||
        live.some((row) => !wanted.has(row.id))
      ) {
        throw new BadRequestException({ message: 'departments.ORDER_MISMATCH' });
      }
      const byId = new Map(live.map((row) => [row.id, row]));
      const ordered = dto.ids.map((id, rank) => {
        const row = byId.get(id)!;
        return { row, rank };
      });
      for (const { row, rank } of ordered) {
        if (row.rank !== rank) {
          await manager.update(Department, { id: row.id }, { rank });
          row.rank = rank;
        }
      }
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'department.reordered',
          targetType: 'workspace',
          targetId: auth.workspaceId,
          meta: { ids: dto.ids },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(auth.workspaceId, { type: 'departments.changed' }));
      return ordered.map(({ row }) => toDepartment(row));
    });
  }

  /**
   * Soft delete. Members, agents and invites that pointed to it end up in "no department"; the
   * room (and everybody's membership of it) stays.
   */
  async remove(auth: AuthContext, id: string): Promise<null> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await lockRooms(manager, auth.workspaceId);
      const row = await findLiveDepartment(manager, auth.workspaceId, id);
      const cleared = {} as Record<'members' | 'agents' | 'invites', number>;
      for (const table of ['members', 'agents', 'invites'] as const) {
        cleared[table] = returnedRows<{ id: string }>(
          await manager.query(
            `UPDATE ${table} SET department_id = NULL WHERE department_id = $1 RETURNING id`,
            [row.id],
          ),
        ).length;
      }
      await manager.softDelete(Department, { id: row.id });
      // Keep the ranks gap-free so the next reorder starts from 0..n-1.
      await manager.query(
        `UPDATE departments d SET rank = r.rank
         FROM (
           SELECT id, (row_number() OVER (ORDER BY rank, name, id) - 1)::int AS rank
           FROM departments WHERE workspace_id = $1 AND deleted_at IS NULL
         ) r
         WHERE d.id = r.id AND d.rank <> r.rank`,
        [auth.workspaceId],
      );
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'department.deleted',
          targetType: 'department',
          targetId: row.id,
          meta: { name: row.name, roomId: row.roomId, ...cleared },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => {
        this.events.publish(auth.workspaceId, { type: 'departments.changed' });
        if (cleared.members > 0 || cleared.invites > 0) {
          this.events.publish(auth.workspaceId, { type: 'members.changed' });
        }
        if (cleared.agents > 0) this.events.publish(auth.workspaceId, { type: 'agents.changed' });
      });
    });
    return null;
  }

  /** Moves a member into a department (or out of every one) and adds them to its room. */
  async setMemberDepartment(
    auth: AuthContext,
    memberId: string,
    dto: SetDepartmentDto,
  ): Promise<MemberContract> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      await lockRooms(manager, auth.workspaceId);
      const member = await this.findMember(manager, auth.workspaceId, memberId);
      const department =
        dto.departmentId === null
          ? null
          : await findLiveDepartment(manager, auth.workspaceId, dto.departmentId);
      const from = member.departmentId;
      let joined = false;
      if (department) joined = await joinDepartmentRoom(manager, department, { memberId });
      if (from !== (department?.id ?? null)) {
        await manager.update(Member, { id: member.id }, { departmentId: department?.id ?? null });
        member.departmentId = department?.id ?? null;
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'member.department_changed',
            targetType: 'member',
            targetId: member.id,
            meta: { from, to: member.departmentId },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => {
          this.events.publish(auth.workspaceId, { type: 'members.changed' });
          this.events.publish(auth.workspaceId, { type: 'departments.changed' });
        });
      }
      if (joined)
        effects.push(() => this.events.publish(auth.workspaceId, { type: 'rooms.changed' }));
      return toMember(member);
    });
  }

  /** The agent's own rules (workspace lock, room join, audit) live in `AgentsService.update`. */
  setAgentDepartment(
    auth: AuthContext,
    agentId: string,
    dto: SetDepartmentDto,
  ): Promise<AgentContract> {
    return this.agents.update(
      auth.workspaceId,
      agentId,
      { departmentId: dto.departmentId } as UpdateAgentDto,
      { memberId: auth.memberId, ip: auth.ip },
    );
  }

  /** Owner|admin sets anyone's title; people set their own through `PATCH /me`. */
  async setMemberTitle(
    auth: AuthContext,
    memberId: string,
    dto: SetMemberTitleDto,
  ): Promise<MemberContract> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const member = await this.findMember(manager, auth.workspaceId, memberId);
      if (member.title !== dto.title) {
        const from = member.title;
        await manager.update(Member, { id: member.id }, { title: dto.title });
        member.title = dto.title;
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'member.title_changed',
            targetType: 'member',
            targetId: member.id,
            meta: { from, to: dto.title },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => this.events.publish(auth.workspaceId, { type: 'members.changed' }));
      }
      return toMember(member);
    });
  }

  // ---------- internals ----------

  /** A live member of the caller's workspace; foreign, removed or malformed ids are a 404. */
  private async findMember(
    manager: EntityManager,
    workspaceId: string,
    memberId: string,
  ): Promise<Member> {
    const member = isUUID(memberId)
      ? await manager.findOne(Member, { where: { id: memberId, workspaceId } })
      : null;
    if (!member || member.removedAt) {
      throw new NotFoundException({ message: 'workspace.MEMBER_NOT_FOUND' });
    }
    return member;
  }

  /** 409 when a live department already has this name (ignoring case); the caller holds the lock. */
  private async assertNameFree(
    manager: EntityManager,
    workspaceId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const rows = returnedRows<{ id: string }>(
      await manager.query(
        `SELECT id FROM departments
         WHERE workspace_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL
           AND ($3::uuid IS NULL OR id <> $3)
         LIMIT 1`,
        [workspaceId, name, exceptId],
      ),
    );
    if (rows.length) throw new ConflictException({ message: 'departments.NAME_TAKEN' });
  }

  /** A unique violation on the name (a race past `assertNameFree`) is a 409, not a 500. */
  private async named<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string; constraint?: string } | undefined)?.code ===
          PG_UNIQUE_VIOLATION &&
        (error.driverError as { constraint?: string }).constraint === NAME_UNIQUE_INDEX
      ) {
        throw new ConflictException({ message: 'departments.NAME_TAKEN' });
      }
      throw error;
    }
  }

  /**
   * The department's public channel, built like `POST /rooms` builds one: the slug of the name
   * (`-2`, `-3`... on a collision with another channel), the actor as its owner, and the same
   * `room.created` audit event. Runs under the rooms lock, so the free name stays free.
   */
  private async createRoom(manager: EntityManager, auth: AuthContext, name: string): Promise<Room> {
    const slug = departmentRoomSlug(name);
    const taken = new Set(
      returnedRows<{ name: string }>(
        await manager.query(
          `SELECT lower(name) AS name FROM rooms
           WHERE workspace_id = $1 AND kind = 'channel'
             AND (lower(name) = $2 OR lower(name) LIKE $2 || '-%')`,
          [auth.workspaceId, slug],
        ),
      ).map((row) => row.name),
    );
    const room = await manager.save(
      manager.create(Room, {
        workspaceId: auth.workspaceId,
        kind: 'channel',
        name: firstFreeRoomName(slug, taken),
        icon: 'users',
        isPrivate: false,
        agentId: null,
        memberId: null,
        connectionId: null,
        createdAt: this.clock.now(),
      }),
    );
    await manager.query(
      `INSERT INTO room_members (workspace_id, room_id, member_id, role, created_at)
       VALUES ($1, $2, $3, 'owner', clock_timestamp())`,
      [auth.workspaceId, room.id, auth.memberId],
    );
    await this.audit.record(
      {
        workspaceId: auth.workspaceId,
        actorMemberId: auth.memberId,
        action: 'room.created',
        targetType: 'room',
        targetId: room.id,
        meta: { name: room.name, isPrivate: false, members: 1, agents: 0, department: name },
        ip: auth.ip,
      },
      manager,
    );
    return room;
  }
}
