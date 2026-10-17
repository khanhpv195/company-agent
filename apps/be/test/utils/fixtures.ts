import { ComputerStatus } from '@repo/shared';
import { DataSource } from 'typeorm';
import { buildSkills } from '../../src/modules/agents/agent-defaults';
import { Agent } from '../../src/modules/agents/entities/agent.entity';
import { Computer } from '../../src/modules/computers/entities/computer.entity';

export const createComputer = (
  ds: DataSource,
  workspaceId: string,
  overrides: Partial<Computer> = {},
): Promise<Computer> =>
  ds.getRepository(Computer).save(
    ds.getRepository(Computer).create({
      workspaceId,
      name: 'test-box',
      os: 'macOS 26.1 · arm64',
      status: 'online' satisfies ComputerStatus,
      lastHeartbeatAt: new Date(),
      keepAwake: false,
      cliVersion: '2.1.0',
      simulated: false,
      ...overrides,
    }),
  );

export const createAgent = (
  ds: DataSource,
  workspaceId: string,
  computerId: string,
  overrides: Partial<Agent> = {},
): Promise<Agent> =>
  ds.getRepository(Agent).save(
    ds.getRepository(Agent).create({
      workspaceId,
      computerId,
      name: 'Claude',
      avatar: 0,
      provider: 'claude-code',
      persona: 'Be helpful.',
      skills: buildSkills(['git-ops', 'summarize', 'translate'], 2),
      workdir: '~/workspace',
      maxTurns: 40,
      ...overrides,
    }),
  );
