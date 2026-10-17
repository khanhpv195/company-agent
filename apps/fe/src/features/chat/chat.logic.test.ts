import type { Agent, Room } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { agentsWithoutDm } from './chat.logic';

const agent = (id: string): Agent => ({ id, name: id, simulated: false }) as unknown as Agent;
const dm = (id: string, agentId: string | null): Room =>
  ({ id, kind: 'dm', agentId, threads: [] }) as unknown as Room;
const channel = (id: string): Room =>
  ({ id, kind: 'channel', agentId: null, threads: [] }) as unknown as Room;

describe('agentsWithoutDm', () => {
  it('returns every agent when there are no rooms', () => {
    expect(agentsWithoutDm([agent('a1'), agent('a2')], []).map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('drops agents that already have a DM and keeps the input order', () => {
    const agents = [agent('a1'), agent('a2'), agent('a3')];
    const rooms = [dm('dm-a2', 'a2')];
    expect(agentsWithoutDm(agents, rooms).map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it('ignores channels and DMs of agents not in the list', () => {
    const agents = [agent('a1')];
    const rooms = [channel('general'), dm('dm-x', 'gone')];
    expect(agentsWithoutDm(agents, rooms).map((a) => a.id)).toEqual(['a1']);
  });

  it('returns an empty list when every agent has a DM', () => {
    expect(agentsWithoutDm([agent('a1')], [dm('dm-a1', 'a1')])).toEqual([]);
  });
});
