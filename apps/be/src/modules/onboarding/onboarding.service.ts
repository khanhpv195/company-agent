import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { CliStatus, Session } from '@repo/shared';
import { DataSource } from 'typeorm';
import { ClockService } from '../../common/clock';
import { AuthContext } from '../../common/types';
import { agentConfig } from '../../config';
import { SIMULATED_CONNECT_DELAY_MS } from '../../contacts';
import {
  buildSkills,
  DEFAULT_ENABLED_SKILLS,
  DEFAULT_MAX_TURNS,
  DEFAULT_PERSONA,
  DEFAULT_SKILL_NAMES,
} from '../agents/agent-defaults';
import { Agent } from '../agents/entities/agent.entity';
import { API_KEY_PREFIX, hashApiKey } from '../computers/computers.service';
import { Computer } from '../computers/entities/computer.entity';
import { EventsService } from '../events';
import { Workspace } from '../workspace/entities/workspace.entity';
import { WorkspaceService } from '../workspace/workspace.service';
import { randomBytes } from 'node:crypto';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly workspaces: WorkspaceService,
  ) {}

  async cliStatus(auth: AuthContext): Promise<CliStatus> {
    const computers = await this.dataSource.getRepository(Computer).find({
      where: { workspaceId: auth.workspaceId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const now = this.clock.now();
    const connected = computers.find(
      (computer) => computer.status === 'online' && this.hasConnected(computer, now),
    );
    if (connected) return { connected: true, computerId: connected.id };

    if (this.config.simulator && computers.length === 0) {
      await this.createSimulatedSetup(auth);
    }
    return { connected: false, computerId: null };
  }

  /** Idempotent: only the first call stamps `onboarded_at`. */
  async complete(auth: AuthContext): Promise<Session> {
    await this.workspaces.markOnboarded(auth.workspaceId);
    return this.workspaces.getSession(auth.memberId);
  }

  /** Simulated computers "connect" only after a short delay (mock timing). */
  private hasConnected(computer: Computer, now: Date): boolean {
    if (!computer.simulated) return true;
    return now.getTime() - computer.createdAt.getTime() > SIMULATED_CONNECT_DELAY_MS;
  }

  /** The workspace row lock makes concurrent polls create the setup exactly once. */
  private async createSimulatedSetup(auth: AuthContext): Promise<void> {
    const memberName = (await this.workspaces.getSession(auth.memberId)).user.name;
    const created = await this.dataSource.transaction(async (manager) => {
      await manager.findOneOrFail(Workspace, {
        where: { id: auth.workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (await manager.exists(Computer, { where: { workspaceId: auth.workspaceId } })) {
        return false;
      }
      const now = this.clock.now();
      const computer = await manager.save(
        manager.create(Computer, {
          workspaceId: auth.workspaceId,
          name: `${memberName}-MacBook-Pro`,
          os: 'macOS 26.1 · arm64',
          status: 'online',
          lastHeartbeatAt: now,
          keepAwake: false,
          cliVersion: '2.1.0',
          simulated: true,
          apiKeyHash: hashApiKey(`${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`),
          createdAt: now,
        }),
      );
      await manager.save(
        manager.create(Agent, {
          workspaceId: auth.workspaceId,
          computerId: computer.id,
          name: 'Claude',
          avatar: 0,
          provider: 'claude-code',
          persona: DEFAULT_PERSONA,
          skills: buildSkills(DEFAULT_SKILL_NAMES, DEFAULT_ENABLED_SKILLS),
          workdir: '~/workspace',
          maxTurns: DEFAULT_MAX_TURNS,
        }),
      );
      return true;
    });
    if (created) {
      this.events.publish(auth.workspaceId, { type: 'computers.changed' });
      this.events.publish(auth.workspaceId, { type: 'agents.changed' });
    }
  }
}
