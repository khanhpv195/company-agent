import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { WorkspacePlan } from '@repo/shared';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { Agent } from '../agents/entities/agent.entity';
import { AgentsService } from '../agents/agents.service';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { Computer } from '../computers/entities/computer.entity';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Assignment, TERMINAL_STATUSES } from '../gateway/entities/assignment.entity';

@Injectable()
export class ComputerAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly gateway: AgentGatewayService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
    private readonly lock: WorkspaceLockService,
    private readonly limits: PlanLimitsService,
  ) {}

  /**
   * Soft revoke: the key is dropped first (the daemon's next call is a 401), the computer reads
   * offline, and everything its agents had open is cancelled through the gateway, so running
   * tasks go back to todo and chat replies fail like any other cancellation. Afterwards its live
   * agents are moved to `moveAgentsTo`, or (demo computers only) deleted; on a real computer
   * without a target they stay attached to the revoked machine.
   */
  async revoke(auth: AuthContext, id: string, moveAgentsTo?: string): Promise<null> {
    const computer = isUUID(id)
      ? await this.dataSource
          .getRepository(Computer)
          .findOneBy({ id, workspaceId: auth.workspaceId })
      : null;
    if (!computer) throw new NotFoundException({ message: 'computers.NOT_FOUND' });
    if (moveAgentsTo) {
      // Fail before anything is revoked; re-checked under the lock below.
      const target = await this.requireTarget(auth.workspaceId, id, moveAgentsTo);
      const plan = await this.limits.lockPlan(this.dataSource.manager, auth.workspaceId);
      await this.assertMoveLimit(this.dataSource.manager, auth.workspaceId, computer, target, plan);
    }

    const { moved, cancelled } = await this.lock.run(auth.workspaceId, async (manager, effects) => {
      const target = moveAgentsTo
        ? await manager.findOneBy(Computer, {
            id: moveAgentsTo,
            workspaceId: auth.workspaceId,
            revokedAt: IsNull(),
          })
        : null;
      if (moveAgentsTo && !target)
        throw new BadRequestException({ message: 'computers.INVALID_MOVE_TARGET' });
      const from = await manager.findOneBy(Computer, { id, workspaceId: auth.workspaceId });
      if (!from) throw new NotFoundException({ message: 'computers.NOT_FOUND' });
      if (target) {
        const plan = await this.limits.lockPlan(manager, auth.workspaceId);
        await this.assertMoveLimit(manager, auth.workspaceId, from, target, plan);
      }
      // A retry on an already revoked computer keeps the original revocation time.
      await manager.update(
        Computer,
        { id },
        {
          apiKeyHash: null,
          status: 'offline',
          revokedAt: from.revokedAt ?? this.clock.now(),
          updatedAt: this.clock.now(),
        },
      );
      const live = await manager.find(Agent, {
        where: { computerId: id, workspaceId: auth.workspaceId },
        select: { id: true },
      });
      const liveIds = live.map((a) => a.id);
      const open = await manager.find(Assignment, {
        where: [
          { computerId: id, status: Not(In([...TERMINAL_STATUSES])) },
          ...(liveIds.length
            ? [{ agentId: In(liveIds), status: Not(In([...TERMINAL_STATUSES])) }]
            : []),
        ],
        select: { id: true },
      });
      let cancelledCount = 0;
      for (const { id: assignmentId } of open) {
        try {
          await this.gateway.cancel(assignmentId, { manager, effects });
          cancelledCount += 1;
        } catch (error) {
          // Finished a moment ago on its own: nothing left to cancel.
          if (!(error instanceof ConflictException || error instanceof NotFoundException))
            throw error;
        }
      }
      let movedCount = 0;
      if (target) {
        // Workdir stays as it is.
        const result = await manager.update(
          Agent,
          { computerId: id, workspaceId: auth.workspaceId },
          { computerId: target.id },
        );
        movedCount = result.affected ?? 0;
      }
      return { moved: movedCount, cancelled: cancelledCount };
    });
    let deleted = 0;
    if (!moveAgentsTo && computer.simulated) {
      const live = await this.dataSource.getRepository(Agent).find({
        where: { computerId: id, workspaceId: auth.workspaceId },
        select: { id: true },
      });
      for (const { id: agentId } of live) {
        await this.agents.remove(
          auth.workspaceId,
          { memberId: auth.memberId, ip: auth.ip },
          agentId,
        );
        deleted += 1;
      }
    }
    await this.audit.record({
      workspaceId: auth.workspaceId,
      actorMemberId: auth.memberId,
      action: 'computer.revoked',
      targetType: 'computer',
      targetId: id,
      meta: { name: computer.name, movedAgents: moved, deletedAgents: deleted },
      ip: auth.ip,
    });
    for (const type of ['computers.changed', 'agents.changed'] as const)
      this.events.publish(auth.workspaceId, { type });
    if (moved || deleted) this.events.publish(auth.workspaceId, { type: 'rooms.changed' });
    if (moved || deleted || cancelled)
      this.events.publish(auth.workspaceId, { type: 'tasks.changed' });
    return null;
  }

  /** A live (not revoked) computer of the workspace other than the one being removed. */
  private async requireTarget(workspaceId: string, fromId: string, targetId: string) {
    const target =
      isUUID(targetId) && targetId !== fromId
        ? await this.dataSource
            .getRepository(Computer)
            .findOneBy({ id: targetId, workspaceId, revokedAt: IsNull() })
        : null;
    if (!target) throw new BadRequestException({ message: 'computers.INVALID_MOVE_TARGET' });
    return target;
  }

  /** Agents on demo computers are free; moving them onto a real one makes them count. */
  private async assertMoveLimit(
    manager: EntityManager,
    workspaceId: string,
    from: Computer,
    target: Computer,
    plan: WorkspacePlan,
  ): Promise<void> {
    if (!from.simulated || target.simulated) return;
    const count = await manager.count(Agent, { where: { computerId: from.id, workspaceId } });
    if (count) await this.limits.assertCanAdd(manager, workspaceId, plan, 'agents', count);
  }
}
