import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Agent as AgentContract, AgentActivity as AgentActivityContract } from '@repo/shared';
import { isUUID } from 'class-validator';
import { In, Not, Repository, type EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AGENT_ACTIVITY_LIMIT } from '../../contacts';
import { Room } from '../chat/entities/room.entity';
import { lockRooms } from '../chat/room-access';
import { Computer } from '../computers/entities/computer.entity';
import { findLiveDepartment, joinDepartmentRoom } from '../departments/department-access';
import type { Department } from '../departments/entities/department.entity';
import { TaskEngineService } from '../tasks/task-engine.service';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { loadLibrary, resolveAgentSkills } from '../skills/skill-access';
import { Member } from '../workspace/entities/member.entity';
import { slugify } from '../workspace/slug.util';
import type { AuthContext } from '../../common/types';
import { EventsService } from '../events';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import {
  Assignment,
  BUSY_STATUSES,
  TASK_WORKING_STATUSES,
  TERMINAL_STATUSES,
} from '../gateway/entities/assignment.entity';
import { toAgent, toAgentActivity } from './agent.mapper';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import { AGENT_AVATAR_VARIANTS, DEFAULT_MAX_TURNS, DEFAULT_PERSONA } from './agent-defaults';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentActivity) private readonly activity: Repository<AgentActivity>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    private readonly events: EventsService,
    private readonly lock: WorkspaceLockService,
    private readonly engine: TaskEngineService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
  ) {}

  async list(workspaceId: string): Promise<AgentContract[]> {
    const rows = await this.agents.find({
      where: { workspaceId },
      relations: { computer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const busy = await this.busyAgentIds(workspaceId);
    const library = await loadLibrary(this.agents.manager, workspaceId);
    return rows.map((row) => toAgent(row, busy.has(row.id), library));
  }

  async get(workspaceId: string, id: string): Promise<AgentContract> {
    const row = await this.findOwned(workspaceId, id);
    const library = await loadLibrary(this.agents.manager, workspaceId);
    return toAgent(row, (await this.busyAgentIds(workspaceId, [id])).has(id), library);
  }

  create(workspaceId: string, dto: CreateAgentDto, actor: AuditActor): Promise<AgentContract> {
    return this.lock.run(workspaceId, async (manager, effects) => {
      const computer = await this.requireComputer(manager, workspaceId, dto.computerId);
      await this.assertNameFree(manager, workspaceId, dto.name);
      const department =
        dto.departmentId === undefined
          ? null
          : await this.requireDepartment(manager, workspaceId, dto.departmentId);
      // Only the skills switched on count; they must be live skills of the workspace.
      const skills = (
        await resolveAgentSkills(
          manager,
          workspaceId,
          (dto.skills ?? []).filter((skill) => skill.enabled).map((skill) => skill.id),
        )
      ).map((skill) => skill.id);
      // Row lock + count in this transaction: two creates (or create_agent tool calls) cannot both
      // take the last slot.
      const plan = await this.limits.lockPlan(manager, workspaceId);
      await this.limits.assertCanAdd(manager, workspaceId, plan, 'agents');
      const existing = await manager.count(Agent, { where: { workspaceId }, withDeleted: true });
      // Names get reused (delete + create): the id suffix keeps a new agent out of an old workdir.
      const id = randomUUID();
      const row = await manager.save(
        manager.create(Agent, {
          id,
          workspaceId,
          computerId: computer.id,
          name: dto.name,
          avatar: existing % AGENT_AVATAR_VARIANTS,
          provider: 'claude-code',
          persona: dto.persona?.trim() ? dto.persona : DEFAULT_PERSONA,
          skills,
          workdir: dto.workdir ?? `~/.agent/agents/${this.slugOf(dto.name)}-${id.slice(0, 6)}`,
          maxTurns: dto.maxTurns ?? DEFAULT_MAX_TURNS,
          departmentId: department?.id ?? null,
          title: dto.title ?? null,
        }),
      );
      row.computer = computer;
      await this.audit.record(
        {
          workspaceId,
          actorMemberId: actor.memberId,
          action: 'agent.created',
          targetType: 'agent',
          targetId: row.id,
          meta: { name: row.name },
          ip: actor.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(workspaceId, { type: 'agents.changed' }));
      if (skills.length) {
        await this.recordSkillsChange(manager, effects, actor, row, [], skills);
      }
      if (department) await this.placeInDepartment(manager, effects, actor, row, department, null);
      return toAgent(row, false, await loadLibrary(manager, workspaceId));
    });
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateAgentDto,
    actor: AuditActor,
  ): Promise<AgentContract> {
    // Under the workspace lock: concurrent PATCHes (skills jsonb, name uniqueness) never interleave.
    return this.lock.run(workspaceId, async (manager, effects) => {
      const row = isUUID(id)
        ? await manager.findOne(Agent, {
            where: { id, workspaceId },
            relations: { computer: true },
          })
        : null;
      if (!row) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
      let renamed = false;
      if (dto.name !== undefined && dto.name !== row.name) {
        await this.assertNameFree(manager, workspaceId, dto.name, row.id);
        row.name = dto.name;
        renamed = true;
      }
      // Lock order: the rooms lock (taken when resolving the department) comes before the
      // workspaces row lock (`limits.lockPlan`), as everywhere else. Resolve the department first.
      let department: Department | null | undefined;
      const departmentBefore = row.departmentId;
      if (dto.departmentId !== undefined) {
        department =
          dto.departmentId === null
            ? null
            : await this.requireDepartment(manager, workspaceId, dto.departmentId);
        row.departmentId = department?.id ?? null;
      }
      if (dto.computerId !== undefined && dto.computerId !== row.computerId) {
        const computer = await this.requireComputer(manager, workspaceId, dto.computerId);
        const open = await manager.exists(Assignment, {
          where: { agentId: row.id, status: Not(In([...TERMINAL_STATUSES])) },
        });
        if (open) throw new ConflictException({ message: 'agents.BUSY' });
        if (row.computer?.simulated && !computer.simulated) {
          const plan = await this.limits.lockPlan(manager, workspaceId);
          await this.limits.assertCanAdd(manager, workspaceId, plan, 'agents');
        }
        row.computerId = computer.id;
        row.computer = computer;
      }
      if (dto.workdir !== undefined) row.workdir = dto.workdir;
      if (dto.maxTurns !== undefined) row.maxTurns = dto.maxTurns;
      if (dto.persona !== undefined) row.persona = dto.persona;
      if (dto.title !== undefined) row.title = dto.title;
      const skillsBefore = row.skills;
      if (dto.skills) {
        // Toggles on top of the live skills the agent already has; ids of deleted skills drop out.
        const live = new Set((await loadLibrary(manager, workspaceId)).map((skill) => skill.id));
        const wanted = new Set(skillsBefore.filter((skillId) => live.has(skillId)));
        for (const skill of dto.skills) {
          if (skill.enabled) wanted.add(skill.id);
          else wanted.delete(skill.id);
        }
        row.skills = (await resolveAgentSkills(manager, workspaceId, [...wanted])).map(
          (skill) => skill.id,
        );
      }
      await manager.save(row);
      await this.audit.record(
        {
          workspaceId,
          actorMemberId: actor.memberId,
          action: 'agent.updated',
          targetType: 'agent',
          targetId: row.id,
          meta: { name: row.name },
          ip: actor.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(workspaceId, { type: 'agents.changed' }));
      if (dto.skills) {
        await this.recordSkillsChange(manager, effects, actor, row, skillsBefore, row.skills);
      }
      if (department !== undefined) {
        await this.placeInDepartment(manager, effects, actor, row, department, departmentBefore);
      }
      if (renamed) {
        // The agent's DMs carry its name.
        await manager.update(Room, { agentId: row.id, kind: 'dm' }, { name: row.name });
        effects.push(() => this.events.publish(workspaceId, { type: 'rooms.changed' }));
      }
      const busy = (await this.busyAgentIds(workspaceId, [id], manager)).has(id);
      return toAgent(row, busy, await loadLibrary(manager, workspaceId));
    });
  }

  /**
   * Replaces the set of skills enabled on the agent. Owner|admin for any agent; a member only for
   * an agent of their own (non-null) department.
   */
  setSkills(auth: AuthContext, id: string, skillIds: string[]): Promise<AgentContract> {
    const { workspaceId } = auth;
    return this.lock.run(workspaceId, async (manager, effects) => {
      const row = isUUID(id)
        ? await manager.findOne(Agent, {
            where: { id, workspaceId },
            relations: { computer: true },
          })
        : null;
      if (!row) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
      if (auth.role !== 'owner' && auth.role !== 'admin') {
        const member = await manager.findOne(Member, {
          where: { id: auth.memberId, workspaceId },
          select: { id: true, departmentId: true },
        });
        if (!member?.departmentId || member.departmentId !== row.departmentId) {
          throw new ForbiddenException({ message: 'skills.AGENT_FORBIDDEN' });
        }
      }
      const before = row.skills;
      row.skills = (await resolveAgentSkills(manager, workspaceId, skillIds)).map(
        (skill) => skill.id,
      );
      await manager.save(row);
      await this.recordSkillsChange(
        manager,
        effects,
        { memberId: auth.memberId, ip: auth.ip },
        row,
        before,
        row.skills,
      );
      const busy = (await this.busyAgentIds(workspaceId, [id], manager)).has(id);
      return toAgent(row, busy, await loadLibrary(manager, workspaceId));
    });
  }

  /** Audits and announces a changed skill set (nothing when the sets are equal). */
  private async recordSkillsChange(
    manager: EntityManager,
    effects: Array<() => void>,
    actor: AuditActor,
    agent: Agent,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const was = new Set(before);
    const is = new Set(after);
    const added = after.filter((skillId) => !was.has(skillId));
    const removed = before.filter((skillId) => !is.has(skillId));
    if (!added.length && !removed.length) return;
    await this.audit.record(
      {
        workspaceId: agent.workspaceId,
        actorMemberId: actor.memberId,
        action: 'agent.skills_changed',
        targetType: 'agent',
        targetId: agent.id,
        meta: { name: agent.name, added, removed },
        ip: actor.ip,
      },
      manager,
    );
    effects.push(() => {
      this.events.publish(agent.workspaceId, { type: 'agents.changed' });
      this.events.publish(agent.workspaceId, { type: 'skills.changed' });
    });
  }

  /** Soft delete (see `TaskCommand.removeAgent`): history keeps the agent id. */
  async remove(workspaceId: string, actor: AuditActor, id: string): Promise<null> {
    if (!isUUID(id)) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
    const agent = await this.agents.findOne({ where: { id, workspaceId }, select: { name: true } });
    await this.engine.deleteAgent(workspaceId, actor.memberId, id);
    await this.audit.record({
      workspaceId,
      actorMemberId: actor.memberId,
      action: 'agent.deleted',
      targetType: 'agent',
      targetId: id,
      meta: { name: agent?.name ?? null },
      ip: actor.ip,
    });
    return null;
  }

  /** Newest first. An unknown (or foreign, or malformed) agent id yields an empty list. */
  async listActivity(workspaceId: string, agentId: string): Promise<AgentActivityContract[]> {
    if (!isUUID(agentId)) return [];
    const rows = await this.activity.find({
      where: { workspaceId, agentId },
      order: { at: 'DESC', id: 'DESC' },
      take: AGENT_ACTIVITY_LIMIT,
    });
    return rows.map(toAgentActivity);
  }

  private async findOwned(workspaceId: string, id: string): Promise<Agent> {
    const row = isUUID(id)
      ? await this.agents.findOne({ where: { id, workspaceId }, relations: { computer: true } })
      : null;
    if (!row) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
    return row;
  }

  /** A live department of the workspace, under the rooms lock (so its room cannot vanish meanwhile). */
  private async requireDepartment(
    manager: EntityManager,
    workspaceId: string,
    departmentId: string,
  ): Promise<Department> {
    await lockRooms(manager, workspaceId);
    return findLiveDepartment(manager, workspaceId, departmentId);
  }

  /**
   * The agent now belongs to `department` (null = none): it joins the department room (never
   * leaving another one) and the move is audited. Joining again is a no-op.
   */
  private async placeInDepartment(
    manager: EntityManager,
    effects: Array<() => void>,
    actor: AuditActor,
    agent: Agent,
    department: Department | null,
    from: string | null,
  ): Promise<void> {
    const joined = department
      ? await joinDepartmentRoom(manager, department, { agentId: agent.id })
      : false;
    if (from !== (department?.id ?? null)) {
      await this.audit.record(
        {
          workspaceId: agent.workspaceId,
          actorMemberId: actor.memberId,
          action: 'agent.department_changed',
          targetType: 'agent',
          targetId: agent.id,
          meta: { from, to: department?.id ?? null },
          ip: actor.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(agent.workspaceId, { type: 'departments.changed' }));
    }
    if (joined) {
      effects.push(() => this.events.publish(agent.workspaceId, { type: 'rooms.changed' }));
    }
  }

  private async requireComputer(
    manager: EntityManager,
    workspaceId: string,
    computerId: string,
  ): Promise<Computer> {
    const computer = isUUID(computerId)
      ? await manager.findOneBy(Computer, { id: computerId, workspaceId })
      : null;
    if (!computer) throw new BadRequestException({ message: 'agents.UNKNOWN_COMPUTER' });
    return computer;
  }

  /** Case-insensitive among live agents; safe because callers hold the workspace lock. */
  private async assertNameFree(
    manager: EntityManager,
    workspaceId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const query = manager
      .createQueryBuilder(Agent, 'a')
      .where('a.workspace_id = :workspaceId AND lower(a.name) = lower(:name)', {
        workspaceId,
        name,
      });
    if (exceptId) query.andWhere('a.id != :exceptId', { exceptId });
    if (await query.getExists()) throw new ConflictException({ message: 'agents.NAME_TAKEN' });
  }

  private slugOf(name: string): string {
    const slug = slugify(name);
    return slug === 'workspace' ? `agent-${randomUUID().slice(0, 8)}` : slug;
  }

  /** One aggregate query for the whole list (no N+1). */
  private async busyAgentIds(
    workspaceId: string,
    agentIds?: string[],
    manager?: EntityManager,
  ): Promise<Set<string>> {
    const query = (manager ? manager.getRepository(Assignment) : this.assignments)
      .createQueryBuilder('a')
      .select('a.agent_id', 'agentId')
      .distinct(true)
      .where('a.workspace_id = :workspaceId', { workspaceId })
      .andWhere(
        `((a.source_kind = 'task' AND a.status IN (:...taskWorking)) OR a.status IN (:...busy))`,
        { taskWorking: [...TASK_WORKING_STATUSES], busy: [...BUSY_STATUSES] },
      );
    if (agentIds) query.andWhere('a.agent_id IN (:...agentIds)', { agentIds });
    const rows = await query.getRawMany<{ agentId: string }>();
    return new Set(rows.map((row) => row.agentId));
  }
}
