import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, BrowseRoom, Message, Room, RoomMembers, Thread } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { RoomsDefaultAndNames1792257668269 } from '../src/database/migrations/1792257668269-RoomsDefaultAndNames';
import { ROOM_MEMBERS_BACKFILL } from '../src/database/migrations/1792256594575-RoomMembers';
import { CHAT_RUN_ENDED_EVENT, type ChatRunEndedPayload } from '../src/modules/chat/chat.constants';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { ChatService } from '../src/modules/chat/chat.service';
import { ChatMessage } from '../src/modules/chat/entities/chat-message.entity';
import { Room as RoomRow } from '../src/modules/chat/entities/room.entity';
import { MessageStore } from '../src/modules/chat/message-store.service';
import { joinDefaultRooms } from '../src/modules/chat/room-access';
import { REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  truncateAll,
} from './utils';

type Verb = 'get' | 'post' | 'patch' | 'delete';
const NIL = '00000000-0000-0000-0000-000000000000';

describe('Rooms (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;
  let chat: ChatService;

  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let alice: LoggedInClient;
  let bob: LoggedInClient;
  let outsider: LoggedInClient;
  let alpha: Agent;
  let beta: Agent;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    emitter = app.get(EventEmitter2);
    chat = app.get(ChatService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
    await setPlan(dataSource, owner.workspaceId, 'team');
    admin = await addMemberWithRole(dataSource, owner, 'admin');
    alice = await addMemberWithRole(dataSource, owner, 'member');
    bob = await addMemberWithRole(dataSource, owner, 'member');
    outsider = await registerAndLogin(app);
    const computer = await createComputer(dataSource, owner.workspaceId);
    alpha = await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Alpha' });
    beta = await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Beta' });
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (event: RealtimeEnvelope) => realtime.push(event));
  });

  // ---------- helpers ----------
  const raw = (verb: Verb, path: string, client: LoggedInClient, body?: object) =>
    request(app.getHttpServer())[verb](`/api/v1${path}`).set(client.bearer).send(body);
  const call = async <T>(
    verb: Verb,
    path: string,
    client: LoggedInClient,
    body?: object,
    expected = 200,
  ): Promise<T> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const fail = async (
    verb: Verb,
    path: string,
    client: LoggedInClient,
    status: number,
    body?: object,
  ): Promise<string> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(status);
    return (response.body as ApiResponse<null>).message;
  };
  const createRoom = (client: LoggedInClient, body: object, expected = 200) =>
    call<Room>('post', '/rooms', client, body, expected);
  const rooms = (client: LoggedInClient) => call<Room[]>('get', '/rooms', client);
  const roomNames = async (client: LoggedInClient) =>
    (await rooms(client)).filter((room) => room.kind === 'channel').map((room) => room.name);
  const roster = (client: LoggedInClient, roomId: string) =>
    call<RoomMembers>('get', `/rooms/${roomId}/members`, client);
  /** The compatibility wrapper answers the root message; this returns its sidebar (legacy) view. */
  const threadIn = async (
    client: LoggedInClient,
    roomId: string,
    body: object = { name: 'Plan' },
  ): Promise<Thread> => {
    const root = await call<Message>('post', `/rooms/${roomId}/threads`, client, body);
    const room = (await call<Room[]>('get', '/rooms', client)).find((r) => r.id === roomId);
    return room!.threads.find((t) => t.id === root.id)!;
  };
  const assignments = () => dataSource.getRepository(Assignment).find();

  // ---------- create ----------
  describe('POST /rooms', () => {
    it('creates a channel owned by the caller with the picked members and agents', async () => {
      const room = await createRoom(alice, {
        name: '  Design  ',
        isPrivate: false,
        memberIds: [bob.memberId, alice.memberId],
        agentIds: [alpha.id],
      });
      expect(room).toMatchObject({
        kind: 'channel',
        name: 'Design',
        isPrivate: false,
        agentId: null,
        threads: [],
        memberCount: 2,
        agentCount: 1,
        myRole: 'owner',
      });
      const people = await roster(alice, room.id);
      expect(people.members.map((m) => [m.memberId, m.role])).toEqual([
        [alice.memberId, 'owner'],
        [bob.memberId, 'member'],
      ]);
      expect(people.agents.map((a) => a.agentId)).toEqual([alpha.id]);
      // Bob sees it as a plain member; Alice's other colleagues do not see it.
      expect((await rooms(bob)).find((r) => r.id === room.id)?.myRole).toBe('member');
      expect(await roomNames(owner)).not.toContain('Design');
      const audit = await dataSource.query(`SELECT action FROM audit_events WHERE target_id = $1`, [
        room.id,
      ]);
      expect(audit).toEqual([{ action: 'room.created' }]);
    });

    it('rejects a taken name (case-insensitive), a bad name and unknown ids', async () => {
      await createRoom(owner, { name: 'Ops' });
      expect(await fail('post', '/rooms', alice, 409, { name: 'ops' })).toBe(
        'A room with this name already exists',
      );
      await fail('post', '/rooms', alice, 400, { name: '   ' });
      await fail('post', '/rooms', alice, 400, { name: 'x'.repeat(81) });
      await createRoom(alice, { name: 'x'.repeat(80) });
      expect(await fail('post', '/rooms', alice, 400, { name: 'A', memberIds: [NIL] })).toBe(
        'Unknown member',
      );
      expect(await fail('post', '/rooms', alice, 400, { name: 'A', agentIds: ['nope'] })).toBe(
        'Unknown agent',
      );
      // A member of another workspace is not addable.
      await fail('post', '/rooms', alice, 400, { name: 'A', memberIds: [outsider.memberId] });
      expect(await roomNames(alice)).not.toContain('A');
    });

    it('does not count removed members or deleted agents', async () => {
      const room = await createRoom(owner, {
        name: 'Crew',
        memberIds: [alice.memberId, bob.memberId],
        agentIds: [alpha.id, beta.id],
      });
      await dataSource.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [bob.memberId]);
      await dataSource.getRepository(Agent).softDelete({ id: beta.id });
      expect(
        await call<Room[]>('get', '/rooms', owner).then((r) => r.find((x) => x.id === room.id)),
      ).toMatchObject({ memberCount: 2, agentCount: 1 });
      const people = await roster(owner, room.id);
      expect(people.members.map((m) => m.memberId).sort()).toEqual(
        [owner.memberId, alice.memberId].sort(),
      );
      expect(people.agents.map((a) => a.agentId)).toEqual([alpha.id]);
    });
  });

  // ---------- visibility, browse, join, leave ----------
  describe('visibility', () => {
    it('hides private rooms (and their threads) from non-members, even admins in lists', async () => {
      const secret = await createRoom(alice, { name: 'Secret', isPrivate: true });
      const thread = await threadIn(alice, secret.id, { name: 'T', message: 'hello' });
      expect(await roomNames(alice)).toContain('Secret');
      for (const other of [owner, admin, bob]) {
        expect(await roomNames(other)).not.toContain('Secret');
        await fail('get', `/chats/${thread.id}/messages`, other, 404);
        await fail('post', `/chats/${thread.id}/messages`, other, 404, { markdown: 'hi' });
      }
      // Not discoverable: 404 for non-members, no join, not in browse.
      await fail('get', `/rooms/${secret.id}/members`, bob, 404);
      await fail('post', `/rooms/${secret.id}/join`, bob, 404);
      await fail('post', `/rooms/${secret.id}/threads`, bob, 404, { name: 'x' });
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', bob)).toEqual([]);
      // Workspace admins may still manage (and so read the roster of) a private room.
      expect((await roster(admin, secret.id)).members).toHaveLength(1);
    });

    it('lists public rooms in browse until joined; join is idempotent', async () => {
      const pub = await createRoom(alice, { name: 'Lounge', agentIds: [alpha.id] });
      expect(await roomNames(bob)).not.toContain('Lounge');
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', bob)).toEqual([
        { id: pub.id, name: 'Lounge', icon: 'users', memberCount: 1, agentCount: 1 },
      ]);
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', alice)).toEqual([]);
      const joined = await call<Room>('post', `/rooms/${pub.id}/join`, bob);
      expect(joined).toMatchObject({ id: pub.id, myRole: 'member', memberCount: 2 });
      await call<Room>('post', `/rooms/${pub.id}/join`, bob);
      expect((await roster(bob, pub.id)).members).toHaveLength(2);
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', bob)).toEqual([]);
      expect(await roomNames(bob)).toContain('Lounge');
    });

    it('connection inboxes stay visible to everybody and cannot be joined or left', async () => {
      const inbox = await dataSource.getRepository(RoomRow).save(
        dataSource.getRepository(RoomRow).create({
          workspaceId: owner.workspaceId,
          kind: 'channel',
          name: 'zalo-inbox',
          icon: 'inbox',
          isPrivate: false,
          connectionId: 'zalo',
        }),
      );
      expect(await roomNames(bob)).toContain('zalo-inbox');
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', bob)).toEqual([]);
      await fail('post', `/rooms/${inbox.id}/join`, bob, 400);
      await fail('post', `/rooms/${inbox.id}/leave`, bob, 400);
      await fail('delete', `/rooms/${inbox.id}`, owner, 400);
      await fail('patch', `/rooms/${inbox.id}`, owner, 400, { name: 'x' });
      await fail('post', `/rooms/${inbox.id}/threads`, owner, 400, { name: 'x' });
    });

    it('leave: promotes the oldest member, may leave the room without humans, never DMs', async () => {
      const room = await createRoom(owner, {
        name: 'Duo',
        memberIds: [alice.memberId, bob.memberId],
        agentIds: [alpha.id],
      });
      await call<null>('post', `/rooms/${room.id}/leave`, owner);
      expect(await roomNames(owner)).not.toContain('Duo');
      const people = await roster(alice, room.id);
      expect(people.members.map((m) => [m.memberId, m.role])).toEqual([
        [alice.memberId, 'owner'],
        [bob.memberId, 'member'],
      ]);
      await fail('post', `/rooms/${room.id}/leave`, owner, 404);
      await call<null>('post', `/rooms/${room.id}/leave`, alice);
      await call<null>('post', `/rooms/${room.id}/leave`, bob);
      // No humans left: the room (and its agent) stay, ownerless and still joinable.
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', owner)).toEqual([
        { id: room.id, name: 'Duo', icon: 'users', memberCount: 0, agentCount: 1 },
      ]);
      const dm = (await call<{ chatId: string }>('post', `/agents/${alpha.id}/dm`, alice)).chatId;
      await fail('post', `/rooms/${dm}/leave`, alice, 400);
    });
  });

  // ---------- rename / privacy / delete ----------
  describe('PATCH and DELETE /rooms/:id', () => {
    it('renames and toggles privacy for the room owner, workspace admins and owners only', async () => {
      const room = await createRoom(alice, {
        name: 'Alpha team',
        memberIds: [bob.memberId],
      });
      await createRoom(owner, { name: 'Taken' });
      const patch = (client: LoggedInClient, body: object, status = 200) =>
        raw('patch', `/rooms/${room.id}`, client, body).then((response) => {
          expect(response.status).toBe(status);
          return (response.body as ApiResponse<Room>).data;
        });
      expect(await patch(alice, { name: 'Alpha Team' })).toMatchObject({ name: 'Alpha Team' });
      await patch(bob, { name: 'Nope' }, 403);
      await patch(outsider, { name: 'Nope' }, 404);
      await patch(owner, { name: 'Renamed by owner' });
      expect(await patch(admin, { name: 'Renamed by admin', isPrivate: true })).toMatchObject({
        name: 'Renamed by admin',
        isPrivate: true,
      });
      await patch(alice, { name: 'taken' }, 409);
      await patch(alice, { name: '' }, 400);
      // Private now: a plain non-member sees nothing.
      await fail(
        'patch',
        `/rooms/${room.id}`,
        await addMemberWithRole(dataSource, owner, 'member'),
        404,
        {
          name: 'x',
        },
      );
      const actions = await dataSource.query(
        `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY created_at`,
        [room.id],
      );
      expect(actions.map((row: { action: string }) => row.action)).toEqual([
        'room.created',
        'room.renamed',
        'room.renamed',
        'room.renamed',
        'room.updated',
      ]);
    });

    it('refuses to edit or delete DMs', async () => {
      const dm = (await call<{ chatId: string }>('post', `/agents/${alpha.id}/dm`, alice)).chatId;
      await fail('patch', `/rooms/${dm}`, alice, 400, { name: 'x' });
      await fail('delete', `/rooms/${dm}`, alice, 400);
      await fail('delete', `/rooms/${dm}`, bob, 404);
    });

    it('deletes with threads, messages and cancels open chat runs; members only per rules', async () => {
      const room = await createRoom(alice, {
        name: 'Doomed',
        isPrivate: true,
        memberIds: [bob.memberId],
        agentIds: [alpha.id],
      });
      const thread = await threadIn(alice, room.id, { name: 'T', message: '@Alpha work please' });
      const [run] = await assignments();
      expect(run).toMatchObject({ agentId: alpha.id, sourceKind: 'chat', status: 'offered' });
      await fail('delete', `/rooms/${room.id}`, bob, 403);
      await fail('delete', `/rooms/${room.id}`, outsider, 404);
      realtime = [];
      await call<null>('delete', `/rooms/${room.id}`, admin);
      expect(await dataSource.getRepository(RoomRow).count({ where: { id: room.id } })).toBe(0);
      expect(await dataSource.getRepository(ChatMessage).count()).toBe(0);
      expect(
        await dataSource.query(`SELECT 1 FROM room_members WHERE room_id = $1`, [room.id]),
      ).toEqual([]);
      expect(
        (await dataSource.getRepository(Assignment).findOneByOrFail({ id: run.id })).status,
      ).toBe('cancelled');
      await fail('get', `/chats/${thread.id}/messages`, alice, 404);
      expect(await roomNames(bob)).not.toContain('Doomed');
      // Members of the room (and nobody else) were told.
      const changed = realtime.filter((e) => e.event.type === 'rooms.changed');
      expect(changed.length).toBeGreaterThan(0);
      for (const e of changed) {
        if (e.memberIds) expect(e.memberIds).not.toContain(outsider.memberId);
      }
      expect(
        changed.some(
          (e) => e.memberIds?.includes(alice.memberId) && e.memberIds.includes(bob.memberId),
        ),
      ).toBe(true);
      const audit = await dataSource.query(
        `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY created_at`,
        [room.id],
      );
      expect(audit.map((row: { action: string }) => row.action)).toContain('room.deleted');
    });
  });

  // ---------- membership ----------
  describe('members', () => {
    it('public: any member adds; private: only room owner or admin', async () => {
      const pub = await createRoom(alice, { name: 'Open', memberIds: [bob.memberId] });
      const added = await call<RoomMembers>('post', `/rooms/${pub.id}/members`, bob, {
        memberIds: [admin.memberId],
        agentIds: [alpha.id],
      });
      expect(added.members.map((m) => m.memberId)).toEqual(
        expect.arrayContaining([admin.memberId, alice.memberId, bob.memberId]),
      );
      expect(added.agents.map((a) => a.agentId)).toEqual([alpha.id]);
      // Re-adding is a no-op; nothing to add is a 400.
      await call<RoomMembers>('post', `/rooms/${pub.id}/members`, bob, { agentIds: [alpha.id] });
      expect(await fail('post', `/rooms/${pub.id}/members`, bob, 400, {})).toBe(
        'Pick at least one member or agent',
      );
      await fail('post', `/rooms/${pub.id}/members`, outsider, 404, { memberIds: [bob.memberId] });
      // A non-member of a public room cannot add (only admins may).
      const stranger = await addMemberWithRole(dataSource, owner, 'member');
      await fail('post', `/rooms/${pub.id}/members`, stranger, 403, {
        memberIds: [stranger.memberId],
      });

      const priv = await createRoom(alice, {
        name: 'Closed',
        isPrivate: true,
        memberIds: [bob.memberId],
      });
      await fail('post', `/rooms/${priv.id}/members`, bob, 403, { agentIds: [beta.id] });
      await call<RoomMembers>('post', `/rooms/${priv.id}/members`, alice, { agentIds: [beta.id] });
      const byAdmin = await call<RoomMembers>('post', `/rooms/${priv.id}/members`, admin, {
        memberIds: [owner.memberId],
      });
      expect(byAdmin.members).toHaveLength(3);
      const audit = await dataSource.query(
        `SELECT meta FROM audit_events WHERE action = 'room.member_added' AND target_id = $1`,
        [priv.id],
      );
      expect(audit).toHaveLength(2);
    });

    it('removes members and agents: owner/admin any, members only themselves', async () => {
      const room = await createRoom(alice, {
        name: 'Team',
        memberIds: [bob.memberId, owner.memberId],
        agentIds: [alpha.id, beta.id],
      });
      const base = `/rooms/${room.id}/members`;
      await fail('delete', `${base}/member/${owner.memberId}`, bob, 403);
      await fail('delete', `${base}/agent/${alpha.id}`, bob, 403);
      await fail('delete', `${base}/robot/${alpha.id}`, alice, 400);
      await fail('delete', `${base}/member/${NIL}`, alice, 404);
      const afterAgent = await call<RoomMembers>('delete', `${base}/agent/${alpha.id}`, alice);
      expect(afterAgent.agents.map((a) => a.agentId)).toEqual([beta.id]);
      await call<RoomMembers>('delete', `${base}/member/${owner.memberId}`, admin);
      // Bob removes himself and no longer sees the room.
      await call<RoomMembers>('delete', `${base}/member/${bob.memberId}`, bob);
      expect(await roomNames(bob)).not.toContain('Team');
      expect((await roster(alice, room.id)).members.map((m) => m.memberId)).toEqual([
        alice.memberId,
      ]);
      // Removing the last owner by an admin promotes the next human, if any.
      await call<RoomMembers>('post', base, alice, { memberIds: [bob.memberId] });
      await call<RoomMembers>('delete', `${base}/member/${alice.memberId}`, admin);
      expect((await roster(bob, room.id)).members).toEqual([
        expect.objectContaining({ memberId: bob.memberId, role: 'owner' }),
      ]);
    });
  });

  // ---------- threads, mentions ----------
  describe('POST /rooms/:id/threads', () => {
    it('creates a thread and posts the first message through the send path, waking member agents', async () => {
      const room = await createRoom(alice, {
        name: 'Build',
        memberIds: [bob.memberId],
        agentIds: [alpha.id],
      });
      const thread = await threadIn(bob, room.id, { name: ' Release ', message: '@Alpha ship it' });
      expect(thread).toMatchObject({
        roomId: room.id,
        name: 'Release',
        connectionId: null,
      });
      const messages = await call<Message[]>('get', `/chats/${thread.id}/messages`, alice);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        author: { kind: 'human', id: bob.memberId },
        markdown: '@Alpha ship it',
      });
      expect(messages[1]).toMatchObject({
        author: { kind: 'agent', id: alpha.id },
        status: 'streaming',
      });
      const runs = await assignments();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ agentId: alpha.id, sourceKind: 'chat' });
      const chatInfo = await call<{ agentIds: string[]; subtitle: string }>(
        'get',
        `/chats/${thread.id}`,
        alice,
      );
      expect(chatInfo).toMatchObject({ agentIds: [alpha.id], subtitle: '# Build' });
      // Without a message it is just an empty thread.
      const empty = await threadIn(alice, room.id, { name: 'Empty' });
      expect(empty.preview).toBe('Empty'); // its root message carries the name
      expect(
        (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)?.threads,
      ).toHaveLength(2);
    });

    it('validates and authorizes', async () => {
      const room = await createRoom(alice, { name: 'Pub' });
      await fail('post', `/rooms/${room.id}/threads`, alice, 400, { name: '' });
      await fail('post', `/rooms/${room.id}/threads`, alice, 400, { name: 'x'.repeat(121) });
      await fail('post', `/rooms/${room.id}/threads`, alice, 400, { name: 'ok', message: 5 });
      // Public room: a non-member may read the list but not start threads.
      await fail('post', `/rooms/${room.id}/threads`, bob, 403, { name: 'ok' });
      await fail('post', `/rooms/${room.id}/threads`, outsider, 404, { name: 'ok' });
      await fail('post', `/rooms/${NIL}/threads`, alice, 404, { name: 'ok' });
    });

    it('wakes only agents of the room; a non-member agent mention is just posted', async () => {
      const room = await createRoom(alice, { name: 'Mix', agentIds: [alpha.id] });
      const thread = await threadIn(alice, room.id);
      const posted = await call<Message>('post', `/chats/${thread.id}/messages`, alice, {
        markdown: 'ping @Beta',
      });
      expect(posted.markdown).toBe('ping @Beta');
      expect(await assignments()).toHaveLength(0);
      // Explicitly addressing an agent outside the room is rejected.
      expect(
        await fail('post', `/chats/${thread.id}/messages`, alice, 400, {
          markdown: 'hi',
          agentId: beta.id,
        }),
      ).toBe('This agent is not in the room');
      await call<Message>('post', `/chats/${thread.id}/messages`, alice, {
        markdown: 'ping @Alpha',
      });
      expect(await assignments()).toHaveLength(1);
      // After Beta joins, it wakes too.
      await call<RoomMembers>('post', `/rooms/${room.id}/members`, alice, { agentIds: [beta.id] });
      await call<Message>('post', `/chats/${thread.id}/messages`, alice, { markdown: '@Beta now' });
      expect((await assignments()).map((a) => a.agentId).sort()).toEqual(
        [alpha.id, beta.id].sort(),
      );
      const info = await call<{ agentIds: string[] }>('get', `/chats/${thread.id}`, alice);
      expect(info.agentIds).toEqual([alpha.id, beta.id]);
    });

    it('agent tools cannot post into a room the agent is not in', async () => {
      const room = await createRoom(alice, { name: 'Tools', agentIds: [alpha.id] });
      const thread = await threadIn(alice, room.id);
      const auth = {
        memberId: alice.memberId,
        workspaceId: alice.workspaceId,
        role: 'member' as const,
      };
      await expect(chat.postAgentMessage(auth, beta.id, thread.id, 'hi')).rejects.toMatchObject({
        response: { message: 'chat.AGENT_NOT_IN_ROOM' },
      });
      await expect(chat.postAgentMessage(auth, alpha.id, thread.id, 'hi')).resolves.toMatchObject({
        markdown: 'hi',
      });
    });
  });

  // ---------- realtime ----------
  describe('realtime targeting', () => {
    it('message events of channels reach room members only, public or private', async () => {
      for (const isPrivate of [true, false]) {
        const room = await createRoom(alice, {
          name: isPrivate ? 'Hidden' : 'Shown',
          isPrivate,
          memberIds: [bob.memberId],
        });
        const thread = await threadIn(alice, room.id);
        realtime = [];
        await call<Message>('post', `/chats/${thread.id}/messages`, alice, { markdown: 'psst' });
        const messageEvents = realtime.filter((e) => e.event.type === 'message.upserted');
        expect(messageEvents.length).toBeGreaterThan(0);
        for (const e of messageEvents) {
          expect([...(e.memberIds ?? [])].sort()).toEqual([alice.memberId, bob.memberId].sort());
        }
        for (const e of realtime.filter((e) => e.event.type === 'rooms.changed')) {
          expect(e.memberIds).toBeDefined();
          expect(e.memberIds).not.toContain(owner.memberId);
        }
      }
    });

    it('membership changes notify the affected members, including the removed one', async () => {
      const room = await createRoom(alice, {
        name: 'Pings',
        isPrivate: true,
        memberIds: [bob.memberId],
      });
      realtime = [];
      await call<RoomMembers>('post', `/rooms/${room.id}/members`, alice, {
        memberIds: [admin.memberId],
      });
      const added = realtime.filter((e) => e.event.type === 'rooms.changed');
      expect(added).toHaveLength(1);
      expect([...added[0].memberIds!].sort()).toEqual(
        [alice.memberId, bob.memberId, admin.memberId].sort(),
      );
      realtime = [];
      await call<RoomMembers>('delete', `/rooms/${room.id}/members/member/${bob.memberId}`, alice);
      const removed = realtime.filter((e) => e.event.type === 'rooms.changed');
      expect(removed).toHaveLength(1);
      expect(removed[0].memberIds).toEqual(expect.arrayContaining([alice.memberId, bob.memberId]));
      expect(removed[0].memberIds).not.toContain(owner.memberId);
    });
  });

  // ---------- backfill, defaults, isolation ----------
  describe('backfill and defaults', () => {
    it('backfills legacy channels with everyone who could see them', async () => {
      const repo = dataSource.getRepository(RoomRow);
      const mk = (name: string, extra: Partial<RoomRow> = {}) =>
        repo.save(
          repo.create({
            workspaceId: owner.workspaceId,
            kind: 'channel',
            name,
            icon: 'users',
            isPrivate: false,
            ...extra,
          }),
        );
      const pub = await mk('legacy-public');
      const priv = await mk('legacy-private', { isPrivate: true });
      const inbox = await mk('legacy-inbox', { icon: 'inbox', connectionId: 'zalo' });
      await dataSource.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [bob.memberId]);
      await dataSource.getRepository(Agent).softDelete({ id: beta.id });
      await dataSource.query(
        `INSERT INTO workspace_connections (workspace_id, provider, status, agent_id, room_id, mode, account, room_name)
         VALUES ($1, 'zalo', 'on', $2, $3, 'draft', 'x', 'legacy-inbox')`,
        [owner.workspaceId, alpha.id, inbox.id],
      );
      await dataSource.query(`DELETE FROM room_members`);
      for (const sql of ROOM_MEMBERS_BACKFILL) await dataSource.query(sql);

      const people = async (id: string) => ({
        members: (
          await dataSource.query(
            `SELECT member_id, role FROM room_members WHERE room_id = $1 AND member_id IS NOT NULL`,
            [id],
          )
        )
          .map((r: { member_id: string }) => r.member_id)
          .sort(),
        agents: (
          await dataSource.query(
            `SELECT agent_id FROM room_members WHERE room_id = $1 AND agent_id IS NOT NULL`,
            [id],
          )
        ).map((r: { agent_id: string }) => r.agent_id),
      });
      const liveMembers = [owner.memberId, admin.memberId, alice.memberId].sort();
      expect(await people(pub.id)).toEqual({ members: liveMembers, agents: [alpha.id] });
      expect(await people(priv.id)).toEqual({ members: liveMembers, agents: [alpha.id] });
      expect(await people(inbox.id)).toEqual({ members: liveMembers, agents: [alpha.id] });
      const ownerRow = await dataSource.query(
        `SELECT role FROM room_members WHERE room_id = $1 AND member_id = $2`,
        [pub.id, owner.memberId],
      );
      expect(ownerRow).toEqual([{ role: 'owner' }]);
      // Everyone sees both legacy channels, exactly as before the migration.
      expect(await roomNames(alice)).toEqual(
        expect.arrayContaining(['legacy-public', 'legacy-private', 'legacy-inbox']),
      );
    });

    it('new members join the default channel and connection inboxes, nothing else', async () => {
      const repo = dataSource.getRepository(RoomRow);
      const base = {
        workspaceId: owner.workspaceId,
        kind: 'channel' as const,
        icon: 'users' as const,
      };
      await repo.save(repo.create({ ...base, name: 'Lobby', isPrivate: false, isDefault: true }));
      // Found by the flag, not by the name: a plain channel called all-members is not joined.
      await repo.save(repo.create({ ...base, name: 'all-members', isPrivate: false }));
      await repo.save(repo.create({ ...base, name: 'secret', isPrivate: true }));
      await repo.save(repo.create({ ...base, name: 'random', isPrivate: false }));
      const newcomer = await addMemberWithRole(dataSource, owner, 'member');
      await dataSource.transaction((manager) =>
        joinDefaultRooms(manager, owner.workspaceId, newcomer.memberId),
      );
      await dataSource.transaction((manager) =>
        joinDefaultRooms(manager, owner.workspaceId, newcomer.memberId),
      );
      expect(await roomNames(newcomer)).toEqual(['Lobby']);
      expect(
        (await call<BrowseRoom[]>('get', '/rooms/browse', newcomer)).map((r) => r.name),
      ).toEqual(['all-members', 'random']);
    });

    it('a removed member drops out of rooms and cannot open their threads', async () => {
      const room = await createRoom(alice, { name: 'Gone', memberIds: [bob.memberId] });
      const thread = await threadIn(alice, room.id, { name: 'T', message: 'hi' });
      await dataSource.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [bob.memberId]);
      expect((await roster(alice, room.id)).members.map((m) => m.memberId)).toEqual([
        alice.memberId,
      ]);
      const message = await call<Message>('post', `/chats/${thread.id}/messages`, alice, {
        markdown: 'still here',
      });
      expect(message.markdown).toBe('still here');
    });
  });

  describe('isolation', () => {
    it('other workspaces cannot see or touch rooms', async () => {
      const room = await createRoom(alice, { name: 'Mine' });
      const thread = await threadIn(alice, room.id);
      expect(await roomNames(outsider)).toEqual([]);
      expect(await call<BrowseRoom[]>('get', '/rooms/browse', outsider)).toEqual([]);
      for (const [verb, path, body] of [
        ['get', `/rooms/${room.id}/members`, undefined],
        ['patch', `/rooms/${room.id}`, { name: 'x' }],
        ['delete', `/rooms/${room.id}`, undefined],
        ['post', `/rooms/${room.id}/join`, undefined],
        ['post', `/rooms/${room.id}/leave`, undefined],
        ['post', `/rooms/${room.id}/members`, { memberIds: [outsider.memberId] }],
        ['delete', `/rooms/${room.id}/members/member/${alice.memberId}`, undefined],
        ['post', `/rooms/${room.id}/threads`, { name: 'x' }],
        ['get', `/chats/${thread.id}/messages`, undefined],
      ] as const) {
        await fail(verb, path, outsider, 404, body);
      }
      expect(await dataSource.getRepository(RoomRow).count({ where: { id: room.id } })).toBe(1);
    });
  });

  // ---------- review fixes ----------
  const realtimeOf = (type: string) => realtime.filter((e) => e.event.type === type);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async <T>(read: () => Promise<T | undefined | false>, ms = 3000): Promise<T> => {
    const started = Date.now();
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() - started > ms) throw new Error('timed out');
      await sleep(20);
    }
  };

  describe('private-room runs stay out of workspace-visible rows', () => {
    it('logs a neutral activity and feed line for a private channel thread, like a DM', async () => {
      const secret = 'zebra-passphrase-4711';
      const room = await createRoom(alice, {
        name: 'board-secrets',
        isPrivate: true,
        agentIds: [alpha.id],
      });
      await threadIn(alice, room.id, { name: 'budget-thread', message: `@Alpha ${secret}` });
      const [run] = await assignments();
      const context = await chat.replyContext(run.id);
      expect(context?.where).toBe('Kênh riêng');
      const ended: ChatRunEndedPayload[] = [];
      emitter.on(CHAT_RUN_ENDED_EVENT, (payload: ChatRunEndedPayload) => ended.push(payload));
      realtime = [];
      await dataSource.transaction(async (manager) => {
        const effects: Array<() => void> = [];
        await chat.recordRun(manager, effects, context!, `reply with ${secret}`, true, 3);
        for (const effect of effects) effect();
      });
      expect(ended).toEqual([
        expect.objectContaining({ ok: true, dm: false, privateRoom: true, preview: '' }),
      ]);
      const feed = await until(async () => {
        const body = await call<{ feed: { text: string }[] }>('get', '/dashboard', owner);
        return body.feed.length ? body.feed : undefined;
      });
      expect(feed.map((item) => item.text)).toEqual([
        expect.stringMatching(/trả lời trong kênh riêng$/),
      ]);
      const everything = JSON.stringify([
        await call('get', '/dashboard', owner),
        await call('get', `/agents/${alpha.id}/activity`, owner),
        await call('get', `/agents/${alpha.id}`, owner),
      ]);
      for (const leaked of [secret, 'board-secrets', 'budget-thread']) {
        expect(everything).not.toContain(leaked);
      }
      expect(everything).toContain('Tin nhắn trong kênh riêng');
      // A public room keeps its descriptive line.
      const open = await createRoom(alice, { name: 'open-room', agentIds: [alpha.id] });
      await threadIn(alice, open.id, { name: 'open-thread', message: '@Alpha hello' });
      const openRun = (await assignments()).find((a) => a.id !== run.id)!;
      expect((await chat.replyContext(openRun.id))?.where).toBe('# open-room › open-thread');
    });
  });

  describe('removing a workspace member', () => {
    it('promotes a new room owner, drops memberships and tells the affected members', async () => {
      const priv = await createRoom(alice, {
        name: 'alice-private',
        isPrivate: true,
        memberIds: [bob.memberId],
      });
      const pub = await createRoom(alice, { name: 'alice-public', memberIds: [bob.memberId] });
      realtime = [];
      await call<null>('delete', `/members/${alice.memberId}`, owner);
      for (const room of [priv, pub]) {
        const people = await roster(bob, room.id);
        expect(people.members.map((m) => [m.memberId, m.role])).toEqual([[bob.memberId, 'owner']]);
      }
      expect(
        await dataSource.query(`SELECT 1 FROM room_members WHERE member_id = $1`, [alice.memberId]),
      ).toEqual([]);
      // A public room changed: everybody is told.
      expect(realtimeOf('rooms.changed').some((e) => e.memberIds === undefined)).toBe(true);
    });

    it('private rooms only: just their members are told', async () => {
      await createRoom(alice, { name: 'only-private', isPrivate: true, memberIds: [bob.memberId] });
      realtime = [];
      await call<null>('delete', `/members/${alice.memberId}`, owner);
      const changed = realtimeOf('rooms.changed');
      expect(changed.length).toBeGreaterThan(0);
      for (const e of changed) {
        expect(e.memberIds).toBeDefined();
        expect(e.memberIds).not.toContain(outsider.memberId);
        expect(e.memberIds).toContain(bob.memberId);
      }
    });
  });

  describe('default channel', () => {
    it('is flagged, can be renamed, but not deleted or made private', async () => {
      const room = await createRoom(owner, { name: 'general' });
      expect(room.isDefault).toBe(false);
      await dataSource.query(`UPDATE rooms SET is_default = true WHERE id = $1`, [room.id]);
      expect((await rooms(owner)).find((r) => r.id === room.id)?.isDefault).toBe(true);
      expect(await fail('delete', `/rooms/${room.id}`, owner, 400)).toBe(
        'This is the default channel: it cannot be deleted or made private',
      );
      await fail('patch', `/rooms/${room.id}`, owner, 400, { isPrivate: true });
      const renamed = await call<Room>('patch', `/rooms/${room.id}`, owner, { name: 'lobby' });
      expect(renamed).toMatchObject({ name: 'lobby', isDefault: true, isPrivate: false });
      await call<Room>('patch', `/rooms/${room.id}`, owner, { isPrivate: false });
      expect(await dataSource.getRepository(RoomRow).count({ where: { id: room.id } })).toBe(1);
    });
  });

  describe('thread creation', () => {
    it('leaves no thread when the first message fails or is too long', async () => {
      const room = await createRoom(alice, { name: 'atomic', agentIds: [alpha.id] });
      await fail('post', `/rooms/${room.id}/threads`, alice, 400, {
        name: 'T',
        message: 'x'.repeat(20_001),
      });
      const spy = jest
        .spyOn(app.get(MessageStore), 'send')
        .mockRejectedValueOnce(new Error('boom'));
      await fail('post', `/rooms/${room.id}/threads`, alice, 500, { name: 'T', message: 'hi' });
      spy.mockRestore();
      expect(await dataSource.getRepository(ChatMessage).count()).toBe(0);
      expect(await assignments()).toHaveLength(0);
      realtime = [];
      const ok = await threadIn(alice, room.id, { name: 'T', message: 'hi' });
      expect(ok.name).toBe('T');
      expect(await dataSource.getRepository(ChatMessage).count()).toBe(1);
    });

    it('answers 404 for a room deleted meanwhile', async () => {
      const room = await createRoom(alice, { name: 'vanishing' });
      await call<null>('delete', `/rooms/${room.id}`, alice);
      await fail('post', `/rooms/${room.id}/threads`, alice, 404, { name: 'T', message: 'hi' });
    });
  });

  describe('channel name uniqueness', () => {
    it('serializes concurrent creates of the same name into one 200 and one 409', async () => {
      const results = await Promise.all(
        ['Race', 'race'].map((name, i) => raw('post', '/rooms', i ? bob : alice, { name })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await dataSource.query(
          `SELECT 1 FROM rooms WHERE lower(name) = 'race' AND kind = 'channel'`,
        ),
      ).toHaveLength(1);
    });

    it('is enforced by the database too, and maps to 409 on connection inboxes', async () => {
      await createRoom(alice, { name: 'Taken-Name' });
      const repo = dataSource.getRepository(RoomRow);
      await expect(
        repo.save(
          repo.create({
            workspaceId: owner.workspaceId,
            kind: 'channel',
            name: 'taken-name',
            icon: 'users',
            isPrivate: false,
          }),
        ),
      ).rejects.toThrow(/UQ_rooms_channel_name_ci/);
      const body = {
        account: 'OA',
        roomName: 'taken-name',
        agentId: alpha.id,
        mode: 'draft',
      };
      expect(await fail('post', '/connections/zalo/connect', owner, 409, body)).toBe(
        'A room with this name already exists',
      );
      const connected = await raw('post', '/connections/zalo/connect', owner, {
        ...body,
        roomName: 'zalo-inbox',
      });
      expect(connected.status).toBe(200);
      // Renaming the inbox onto a taken name is a conflict as well.
      await fail('post', '/connections/zalo/connect', owner, 409, body);
    });

    it('the migration dedupes existing names and flags the oldest all-members as default', async () => {
      const runner = dataSource.createQueryRunner();
      await dataSource.query(`DROP INDEX "UQ_rooms_channel_name_ci"`);
      await dataSource.query(`ALTER TABLE rooms DROP COLUMN is_default`);
      try {
        // Raw inserts: the entity now has is_default, which the column-less table lacks.
        const insert = (name: string, ageMin: number) =>
          dataSource.query(
            `INSERT INTO rooms (workspace_id, kind, name, icon, is_private, created_at)
             VALUES ($1, 'channel', $2, 'users', false, now() - ($3 || ' minutes')::interval)`,
            [owner.workspaceId, name, String(ageMin)],
          );
        await insert('All-Members', 30);
        await insert('all-members', 20);
        await insert('all-members (2)', 10);
        await insert('Ops', 5);
        await insert('ops', 4);
        await new RoomsDefaultAndNames1792257668269().up(runner);
      } catch (error) {
        // Put the schema back before failing, or every later spec breaks.
        await dataSource.query(
          `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false`,
        );
        throw error;
      } finally {
        await runner.release();
      }
      const rows = (await dataSource.query(
        `SELECT name, is_default FROM rooms WHERE kind = 'channel' ORDER BY created_at ASC`,
      )) as { name: string; is_default: boolean }[];
      expect(rows.map((r) => r.name)).toEqual([
        'All-Members',
        'all-members (3)',
        'all-members (2)',
        'Ops',
        'ops (2)',
      ]);
      expect(rows.filter((r) => r.is_default).map((r) => r.name)).toEqual(['All-Members']);
    });
  });

  describe('realtime audiences', () => {
    it('public rooms notify the whole workspace; private ones their members plus the actor', async () => {
      realtime = [];
      const pub = await createRoom(alice, { name: 'town-square' });
      expect(realtimeOf('rooms.changed').map((e) => e.memberIds)).toEqual([undefined]);
      realtime = [];
      await call<Room>('patch', `/rooms/${pub.id}`, alice, { name: 'town-hall' });
      expect(realtimeOf('rooms.changed').map((e) => e.memberIds)).toEqual([undefined]);
      // public -> private and back: browse lists everywhere must refresh.
      for (const isPrivate of [true, false]) {
        realtime = [];
        await call<Room>('patch', `/rooms/${pub.id}`, alice, { isPrivate });
        expect(realtimeOf('rooms.changed').map((e) => e.memberIds)).toEqual([undefined]);
      }
      realtime = [];
      await call<Room>('post', `/rooms/${pub.id}/join`, bob);
      await call<RoomMembers>('post', `/rooms/${pub.id}/members`, alice, {
        memberIds: [admin.memberId],
      });
      expect(realtimeOf('rooms.changed').map((e) => e.memberIds)).toEqual([undefined, undefined]);
      realtime = [];
      await call<null>('delete', `/rooms/${pub.id}`, alice);
      expect(realtimeOf('rooms.changed').map((e) => e.memberIds)).toEqual([undefined]);

      // Private: members only, plus an admin managing a room they are not in.
      const priv = await createRoom(alice, {
        name: 'war-room',
        isPrivate: true,
        memberIds: [bob.memberId],
      });
      realtime = [];
      await call<Room>('patch', `/rooms/${priv.id}`, owner, { name: 'war-room-2' });
      const changed = realtimeOf('rooms.changed');
      expect(changed).toHaveLength(1);
      expect([...changed[0].memberIds!].sort()).toEqual(
        [alice.memberId, bob.memberId, owner.memberId].sort(),
      );
      expect(changed[0].memberIds).not.toContain(outsider.memberId);
      realtime = [];
      await call<null>('delete', `/rooms/${priv.id}`, owner);
      for (const e of realtimeOf('rooms.changed')) {
        expect(e.memberIds).toEqual(expect.arrayContaining([alice.memberId, owner.memberId]));
        expect(e.memberIds).not.toContain(outsider.memberId);
      }
    });
  });

  describe('removing an agent from a room', () => {
    it('cancels its open chat runs in the room and fails the reply, others keep running', async () => {
      const room = await createRoom(alice, {
        name: 'agents-out',
        agentIds: [alpha.id, beta.id],
      });
      const thread = await threadIn(alice, room.id, { name: 'T' });
      await call<Message>('post', `/chats/${thread.id}/messages`, alice, { markdown: '@Alpha go' });
      await call<Message>('post', `/chats/${thread.id}/messages`, alice, { markdown: '@Beta go' });
      const runs = await assignments();
      expect(runs).toHaveLength(2);
      // The same agent's run in another room is not touched.
      const other = await createRoom(alice, { name: 'elsewhere', agentIds: [alpha.id] });
      await threadIn(alice, other.id, { name: 'T2', message: '@Alpha elsewhere' });
      expect(await assignments()).toHaveLength(3);

      await call<RoomMembers>('delete', `/rooms/${room.id}/members/agent/${alpha.id}`, alice);
      const byAgent = async (agentId: string) =>
        (await assignments())
          .filter((a) => a.agentId === agentId)
          .map((a) => a.status)
          .sort();
      expect(await byAgent(alpha.id)).toEqual(['cancelled', 'offered']);
      expect(await byAgent(beta.id)).toEqual(['offered']);
      const failed = await until(async () => {
        const messages = await call<Message[]>('get', `/chats/${thread.id}/messages`, alice);
        const reply = messages.find((m) => m.author.kind === 'agent' && m.author.id === alpha.id);
        return reply?.status === 'failed' ? reply : undefined;
      });
      expect(failed.assignment?.status).toBe('cancelled');
    });
  });

  describe('deleting a room while a runner reports', () => {
    it('does not deadlock with a result arriving for an open reply', async () => {
      const room = await createRoom(alice, { name: 'busy', agentIds: [alpha.id] });
      const thread = await threadIn(alice, room.id, { name: 'T' });
      for (let i = 0; i < 3; i++) {
        await call<Message>('post', `/chats/${thread.id}/messages`, alice, {
          markdown: '@Alpha go',
        });
      }
      const open = (await assignments()).map((a) => a.id);
      // A runner locks its assignment, then its message: do the same while the room is deleted.
      const finish = Promise.all(
        open.map((id) =>
          dataSource.transaction(async (manager) => {
            await manager.query(`SELECT id FROM assignments WHERE id = $1 FOR UPDATE`, [id]);
            await sleep(10);
            await manager.query(`UPDATE messages SET status = 'failed' WHERE assignment_id = $1`, [
              id,
            ]);
          }),
        ),
      );
      const [deleted] = await Promise.allSettled([
        raw('delete', `/rooms/${room.id}`, alice),
        finish,
      ]);
      expect(deleted.status).toBe('fulfilled');
      expect(await dataSource.getRepository(RoomRow).count({ where: { id: room.id } })).toBe(0);
    });
  });
});
