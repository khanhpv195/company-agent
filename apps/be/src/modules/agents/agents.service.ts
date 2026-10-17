import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Agent as AgentContract, AgentActivity as AgentActivityContract } from '@repo/shared';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { AGENT_ACTIVITY_LIMIT } from '../../contacts';
import { EventsService } from '../events';
import {
  Assignment,
  BUSY_STATUSES,
  TASK_WORKING_STATUSES,
} from '../gateway/entities/assignment.entity';
import { toAgent, toAgentActivity } from './agent.mapper';
import { UpdateAgentDto } from './dto/agent.dto';
import { AgentActivity } from './entities/agent-activity.entity';
import { Agent } from './entities/agent.entity';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentActivity) private readonly activity: Repository<AgentActivity>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    private readonly events: EventsService,
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

  async update(workspaceId: string, id: string, dto: UpdateAgentDto): Promise<AgentContract> {
    // Row lock: two concurrent PATCHes of the skills jsonb must not overwrite each other.
    await this.agents.manager.transaction(async (manager) => {
      const locked = isUUID(id)
        ? await manager.findOne(Agent, {
            where: { id, workspaceId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (!locked) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
      if (dto.persona !== undefined) locked.persona = dto.persona;
      if (dto.skills) {
        const enabledById = new Map(dto.skills.map((skill) => [skill.id, skill.enabled]));
        locked.skills = locked.skills.map((skill) =>
          enabledById.has(skill.id) ? { ...skill, enabled: enabledById.get(skill.id)! } : skill,
        );
      }
      await manager.save(locked);
    });
    const row = await this.findOwned(workspaceId, id);
    this.events.publish(workspaceId, { type: 'agents.changed' });
    return toAgent(row, (await this.busyAgentIds(workspaceId, [id])).has(id));
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

  /** One aggregate query for the whole list (no N+1). */
  private async busyAgentIds(workspaceId: string, agentIds?: string[]): Promise<Set<string>> {
    const query = this.assignments
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
