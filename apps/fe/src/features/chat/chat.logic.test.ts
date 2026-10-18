import type { Agent, Room } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  agentsWithoutDm,
  canDeleteMessage,
  canRenameThread,
  resolveLegacyChatId,
  threadLabel,
  workedFor,
} from './chat.logic';

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

describe('resolveLegacyChatId', () => {
  const rooms = [
    {
      id: 'room-1',
      kind: 'channel',
      agentId: null,
      threads: [{ id: 'root-9' }],
    },
    { id: 'dm-1', kind: 'dm', agentId: 'a1', threads: [] },
  ] as unknown as Room[];

  it('keeps a room id as it is', () => {
    expect(resolveLegacyChatId(rooms, 'dm-1')).toEqual({ roomId: 'dm-1' });
  });
  it('maps a thread root id to its room with the thread open', () => {
    expect(resolveLegacyChatId(rooms, 'root-9')).toEqual({ roomId: 'room-1', thread: 'root-9' });
  });
  it('returns null for an unknown id', () => {
    expect(resolveLegacyChatId(rooms, 'nope')).toBeNull();
  });
});

describe('canRenameThread', () => {
  const base = {
    me: 'u1',
    rootAuthorId: 'u2',
    myRoomRole: 'member' as const,
    workspaceRole: 'member',
  };
  it('allows the root author, the room owner and workspace owner/admin only', () => {
    expect(canRenameThread({ ...base, rootAuthorId: 'u1' })).toBe(true);
    expect(canRenameThread({ ...base, myRoomRole: 'owner' })).toBe(true);
    expect(canRenameThread({ ...base, workspaceRole: 'admin' })).toBe(true);
    expect(canRenameThread(base)).toBe(false);
    expect(canRenameThread({ ...base, me: undefined })).toBe(false);
  });
});

describe('threadLabel', () => {
  it('keeps a real title and otherwise uses the first line of the root', () => {
    expect(threadLabel('Hello', 'ignored')).toBe('Hello');
    expect(threadLabel('  ', '**First** line\nsecond')).toBe('First line');
    expect(threadLabel(null, '')).toBe('');
    expect(threadLabel(null, 'x'.repeat(130)).endsWith('...')).toBe(true);
    expect(threadLabel(null, 'x'.repeat(130)).length).toBe(120);
  });
});

describe('workedFor', () => {
  it('formats seconds and minutes', () => {
    expect(workedFor(12_400)).toBe('12s');
    expect(workedFor(125_000)).toBe('2m 5s');
    expect(workedFor(120_000)).toBe('2m');
  });
});

describe('canDeleteMessage', () => {
  const author = { kind: 'human', id: 'u2' };
  it('allows the author, a room owner and a workspace admin', () => {
    expect(canDeleteMessage({ me: 'u2', author })).toBe(true);
    expect(canDeleteMessage({ me: 'u1', author, myRoomRole: 'owner' })).toBe(true);
    expect(canDeleteMessage({ me: 'u1', author, workspaceRole: 'admin' })).toBe(true);
    expect(
      canDeleteMessage({ me: 'u1', author, myRoomRole: 'member', workspaceRole: 'member' }),
    ).toBe(false);
  });
});
