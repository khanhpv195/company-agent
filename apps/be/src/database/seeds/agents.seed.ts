import { Logger } from '@nestjs/common';
import type { AgentActivity as AgentActivityContract } from '@repo/shared';
import type { DataSource } from 'typeorm';
import { DEFAULT_MAX_TURNS, DEFAULT_PERSONA } from '../../modules/agents/agent-defaults';
import { AgentActivity } from '../../modules/agents/entities/agent-activity.entity';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { Computer } from '../../modules/computers/entities/computer.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const HOUR = 3_600_000;

/** Port of the FE mock fixtures (apps/fe/src/mocks/fixtures.ts): c1 -> simulated and online. */
const COMPUTERS = [
  {
    key: 'c1',
    name: 'khanhpv-MacBook-Pro',
    os: 'macOS 26.1 · arm64',
    status: 'online' as const,
    ageMs: 2_000,
    keepAwake: true,
    cliVersion: '0.14.2',
    simulated: true,
  },
  {
    key: 'c2',
    name: 'build-box',
    os: 'Ubuntu 24.04 · x64',
    status: 'offline' as const,
    ageMs: 7_240_000,
    keepAwake: false,
    cliVersion: '0.13.9',
    simulated: false,
  },
];

const AGENTS: {
  name: string;
  avatar: number;
  computer: string;
  workdir: string;
  activity: {
    where: string;
    request: string;
    status: AgentActivityContract['status'];
    agoH: number;
  }[];
}[] = [
  {
    name: "khanhpv's Claude",
    avatar: 0,
    computer: 'c1',
    workdir: '~/.agent/agents/a1',
    activity: [
      { where: 'DM', request: 'Tin nhắn riêng (DM)', status: 'completed', agoH: 23 },
      { where: 'DM', request: 'Tin nhắn riêng (DM)', status: 'completed', agoH: 26 },
      { where: 'DM', request: 'Tin nhắn riêng (DM)', status: 'expired', agoH: 72 },
    ],
  },
  {
    name: 'Research Bot',
    avatar: 1,
    computer: 'c1',
    workdir: '~/.agent/agents/a2',
    activity: [
      { where: '#test › Hello', request: 'Hello', status: 'completed', agoH: 23 },
      { where: '#test › Hello', request: 'Crawl giá đối thủ', status: 'failed', agoH: 6 },
    ],
  },
  {
    name: 'Deployer',
    avatar: 2,
    computer: 'c2',
    workdir: '/srv/agent/a3',
    activity: [{ where: '#all-members', request: 'deploy staging', status: 'failed', agoH: 48 }],
  },
];

/** Idempotent: computers and agents are matched by name within the seeded workspace. */
export const seedAgents = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:agents');

  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    const now = Date.now();

    const computerIds = new Map<string, string>();
    for (const data of COMPUTERS) {
      let computer = await manager.findOne(Computer, {
        where: { workspaceId: workspace.id, name: data.name },
      });
      if (!computer) {
        computer = await manager.save(
          manager.create(Computer, {
            workspaceId: workspace.id,
            name: data.name,
            os: data.os,
            status: data.status,
            lastHeartbeatAt: new Date(now - data.ageMs),
            keepAwake: data.keepAwake,
            cliVersion: data.cliVersion,
            simulated: data.simulated,
          }),
        );
        logger.log(`Created computer ${data.name}`);
      }
      computerIds.set(data.key, computer.id);
    }

    for (const data of AGENTS) {
      // Soft-deleted agents count too: a seed never resurrects what a user deleted.
      const taken = await manager.exists(Agent, {
        where: { workspaceId: workspace.id, name: data.name },
        withDeleted: true,
      });
      if (taken) continue;
      const agent = await manager.save(
        manager.create(Agent, {
          workspaceId: workspace.id,
          computerId: computerIds.get(data.computer)!,
          name: data.name,
          avatar: data.avatar,
          provider: 'claude-code',
          persona: DEFAULT_PERSONA,
          skills: [],
          workdir: data.workdir,
          maxTurns: DEFAULT_MAX_TURNS,
        }),
      );
      await manager.save(
        data.activity.map((item) =>
          manager.create(AgentActivity, {
            workspaceId: workspace.id,
            agentId: agent.id,
            location: item.where,
            request: item.request,
            status: item.status,
            at: new Date(now - item.agoH * HOUR),
          }),
        ),
      );
      logger.log(`Created agent ${data.name}`);
    }
  });
};
