import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  Agent as AgentContract,
  AgentActivity as AgentActivityContract,
  AgentSkill as AgentSkillContract,
} from '@repo/shared';
import { isUUID } from 'class-validator';
import { In, Not, Repository, type EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AGENT_ACTIVITY_LIMIT } from '../../contacts';
import { Room } from '../chat/entities/room.entity';
import { Computer } from '../computers/entities/computer.entity';
import { TaskEngineService } from '../tasks/task-engine.service';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { slugify } from '../workspace/slug.util';
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
import {
  AGENT_AVATAR_VARIANTS,
  DEFAULT_MAX_TURNS,
  DEFAULT_PERSONA,
  defaultSkills,
} from './agent-defaults';
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
    return rows.map((row) => toAgent(row, busy.has(row.id)));
  }

  async get(workspaceId: string, id: string): Promise<AgentContract> {
    const row = await this.findOwned(workspaceId, id);
    return toAgent(row, (await this.busyAgentIds(workspaceId, [id])).has(id));
  }

  /** Every skill the product knows, with its default flag (what a new agent starts with). */
  skillCatalog(): AgentSkillContract[] {
    return defaultSkills();
  }

  create(workspaceId: string, dto: CreateAgentDto, actor: AuditActor): Promise<AgentContract> {
    return this.lock.run(workspaceId, async (manager, effects) => {
      const computer = await this.requireComputer(manager, workspaceId, dto.computerId);
      await this.assertNameFree(manager, workspaceId, dto.name);
      const catalog = defaultSkills();
      const known = new Set(catalog.map((skill) => skill.id));
      if (dto.skills?.some((skill) => !known.has(skill.id)))
        throw new BadRequestException({ message: 'agents.UNKNOWN_SKILL' });
      const enabledById = new Map(dto.skills?.map((skill) => [skill.id, skill.enabled]));
      // With an explicit list, only the listed skills are on; otherwise the catalog defaults.
      const skills = catalog.map((skill) => ({
        ...skill,
        enabled: dto.skills ? (enabledById.get(skill.id) ?? false) : skill.enabled,
      }));
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
      return toAgent(row, false);
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
      if (dto.computerId !== undefined && dto.computerId !== row.computerId) {
        const computer = await this.requireComputer(manager, workspaceId, dto.computerId);
        const open = await manager.exists(Assignment, {
          where: { agentId: row.id, status: Not(In([...TERMINAL_STATUSES])) },
        });
        if (open) throw new ConflictException({ message: 'agents.BUSY' });
        row.computerId = computer.id;
        row.computer = computer;
      }
      if (dto.workdir !== undefined) row.workdir = dto.workdir;
      if (dto.maxTurns !== undefined) row.maxTurns = dto.maxTurns;
      if (dto.persona !== undefined) row.persona = dto.persona;
      if (dto.skills) {
        const enabledById = new Map(dto.skills.map((skill) => [skill.id, skill.enabled]));
        row.skills = row.skills.map((skill) =>
          enabledById.has(skill.id) ? { ...skill, enabled: enabledById.get(skill.id)! } : skill,
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
      if (renamed) {
        // The agent's DMs carry its name.
        await manager.update(Room, { agentId: row.id, kind: 'dm' }, { name: row.name });
        effects.push(() => this.events.publish(workspaceId, { type: 'rooms.changed' }));
      }
      const busy = (await this.busyAgentIds(workspaceId, [id], manager)).has(id);
      return toAgent(row, busy);
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
