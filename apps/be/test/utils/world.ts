import { DataSource } from 'typeorm';
import { seedTasksFor, type AgentKey, type MemberKey } from '../../src/database/seeds/tasks.seed';
import { Agent } from '../../src/modules/agents/entities/agent.entity';
import { Computer } from '../../src/modules/computers/entities/computer.entity';
import { Member } from '../../src/modules/workspace/entities/member.entity';
import { LoggedInClient } from './auth';
import { createAgent, createComputer } from './fixtures';

export interface World {
  /** Member u1 (owner) of the workspace. */
  me: LoggedInClient;
  c1: Computer;
  /** Offline. */
  c2: Computer;
  agents: Record<AgentKey, Agent>;
  members: Record<MemberKey, string>;
}

/**
 * The FE mock's world in a fresh workspace: an online and an offline computer, three agents
 * (a1, a2 on c1; a3 on c2), three members, and the fixture tasks (AG-15..AG-31) with AG-31 and
 * AG-30 running. Built from the same data as the dev seed. Both computers are simulated, so
 * their runs follow the scripted steps and chat replies wait for the simulator.
 */
export const createWorld = async (
  dataSource: DataSource,
  me: LoggedInClient,
  now: number,
): Promise<World> => {
  const workspaceId = me.workspaceId;
  const c1 = await createComputer(dataSource, workspaceId, {
    name: 'khanhpv-MacBook-Pro',
    simulated: true,
  });
  const c2 = await createComputer(dataSource, workspaceId, {
    name: 'build-box',
    status: 'offline',
    simulated: true,
  });
  const a1 = await createAgent(dataSource, workspaceId, c1.id, { name: "khanhpv's Claude" });
  const a2 = await createAgent(dataSource, workspaceId, c1.id, { name: 'Research Bot' });
  const a3 = await createAgent(dataSource, workspaceId, c2.id, { name: 'Deployer' });
  const [u2, u3] = await dataSource.getRepository(Member).save(
    ['u2', 'u3'].map((key) =>
      dataSource.getRepository(Member).create({
        workspaceId,
        name: key === 'u2' ? 'Hằng' : 'Minh',
        email: `${key}-${me.memberId}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'member',
        color: null,
      }),
    ),
  );
  const agents = { a1, a2, a3 };
  const members = { u1: me.memberId, u2: u2.id, u3: u3.id };
  await dataSource.transaction((manager) =>
    seedTasksFor(manager, {
      workspaceId,
      now,
      agents: { a1: a1.id, a2: a2.id, a3: a3.id },
      members,
    }),
  );
  return { me, c1, c2, agents, members };
};
