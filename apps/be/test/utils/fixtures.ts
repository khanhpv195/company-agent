import { ComputerStatus } from '@repo/shared';
import { DataSource } from 'typeorm';
import { Agent } from '../../src/modules/agents/entities/agent.entity';
import { Computer } from '../../src/modules/computers/entities/computer.entity';
import { Skill } from '../../src/modules/skills/entities/skill.entity';

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
      skills: [],
      workdir: '~/workspace',
      maxTurns: 40,
      ...overrides,
    }),
  );

/** Puts members and agents into a channel (rooms inserted directly have no memberships). */
export const joinAll = async (
  ds: DataSource,
  roomId: string,
  memberIds: string[],
  agentIds: string[] = [],
): Promise<void> => {
  const [{ workspace_id: workspaceId }] = (await ds.query(
    `SELECT workspace_id FROM rooms WHERE id = $1`,
    [roomId],
  )) as { workspace_id: string }[];
  for (const id of memberIds) {
    await ds.query(
      `INSERT INTO room_members (workspace_id, room_id, member_id, role) VALUES ($1, $2, $3, 'member')`,
      [workspaceId, roomId, id],
    );
  }
  for (const id of agentIds) {
    await ds.query(
      `INSERT INTO room_members (workspace_id, room_id, agent_id, role) VALUES ($1, $2, $3, 'member')`,
      [workspaceId, roomId, id],
    );
  }
};

/** A library skill inserted directly (no HTTP, no audit), live and created by nobody. */
export const createSkill = (
  ds: DataSource,
  workspaceId: string,
  overrides: Partial<Skill> = {},
): Promise<Skill> =>
  ds.getRepository(Skill).save(
    ds.getRepository(Skill).create({
      workspaceId,
      slug: 'git',
      name: 'Git',
      description: 'Use when the task needs git.',
      content: '# Git\n\nUse git carefully.',
      version: 1,
      ...overrides,
    }),
  );
