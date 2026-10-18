import { ConflictException } from '@nestjs/common';
import { QueryFailedError, type EntityManager } from 'typeorm';
import { returnedRows } from '../../common/utils';

/** Case-insensitive unique index on channel names (see the RoomsDefaultAndNames migration). */
export const ROOM_NAME_UNIQUE_INDEX = 'UQ_rooms_channel_name_ci';

const driverError = (error: unknown): { code?: string; constraint?: string } | undefined =>
  error instanceof QueryFailedError
    ? (error.driverError as { code?: string; constraint?: string } | undefined)
    : undefined;

/** Turns a unique violation on the channel name index into 409 `chat.ROOM_NAME_TAKEN`; rethrows anything else. */
export const mapRoomNameConflict = (error: unknown): never => {
  const driver = driverError(error);
  if (driver?.code === '23505' && driver.constraint === ROOM_NAME_UNIQUE_INDEX) {
    throw new ConflictException({ message: 'chat.ROOM_NAME_TAKEN' });
  }
  throw error;
};

/** 409 `chat.ROOM_NAME_TAKEN` when another channel of the workspace already has this name (ignoring case). */
export const assertRoomNameFree = async (
  manager: EntityManager,
  workspaceId: string,
  name: string,
  exceptId: string | null,
): Promise<void> => {
  const rows = returnedRows<{ id: string }>(
    await manager.query(
      `SELECT id FROM rooms
       WHERE workspace_id = $1 AND kind = 'channel' AND lower(name) = lower($2)
         AND ($3::uuid IS NULL OR id <> $3)
       LIMIT 1`,
      [workspaceId, name, exceptId],
    ),
  );
  if (rows.length) throw new ConflictException({ message: 'chat.ROOM_NAME_TAKEN' });
};

/** Runs `fn`; a deadlock (SQLSTATE 40P01) is retried once, since the transaction rolled back whole. */
export const retryOnDeadlock = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (driverError(error)?.code !== '40P01') throw error;
    return fn();
  }
};

/**
 * Serializes room commands per workspace (name uniqueness, the last-owner rule). Take it before
 * touching any row a room command also touches, to keep the lock order consistent.
 */
export const lockRooms = async (manager: EntityManager, workspaceId: string): Promise<void> => {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `rooms:${workspaceId}`,
  ]);
};

/**
 * After an owner left a room: when no live human owner remains, the oldest remaining human
 * member takes over (none left = an ownerless room).
 */
export const promoteRoomOwner = async (manager: EntityManager, roomId: string): Promise<void> => {
  const owners = returnedRows<{ id: string }>(
    await manager.query(
      `SELECT rm.id FROM room_members rm JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
       WHERE rm.room_id = $1 AND rm.role = 'owner' LIMIT 1`,
      [roomId],
    ),
  );
  if (owners.length) return;
  await manager.query(
    `UPDATE room_members SET role = 'owner'
     WHERE id = (
       SELECT rm.id FROM room_members rm
       JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
       WHERE rm.room_id = $1
       ORDER BY rm.created_at ASC, rm.id ASC LIMIT 1
     )`,
    [roomId],
  );
};

/**
 * Forgets what a member kept per room once they are out of it (left, removed): the read cursors
 * (room and threads), mutes and pins, so rejoining starts clean instead of showing a stale mute
 * or the whole backlog as unread. Call in the transaction that deletes the membership.
 */
export const dropRoomState = async (
  manager: EntityManager,
  memberId: string,
  roomId: string,
): Promise<void> => {
  const roots = `SELECT id FROM messages WHERE room_id = $2`;
  await manager.query(`DELETE FROM room_reads WHERE member_id = $1 AND room_id = $2`, [
    memberId,
    roomId,
  ]);
  await manager.query(`DELETE FROM room_mutes WHERE member_id = $1 AND room_id = $2`, [
    memberId,
    roomId,
  ]);
  await manager.query(`DELETE FROM thread_mutes WHERE member_id = $1 AND root_id IN (${roots})`, [
    memberId,
    roomId,
  ]);
  await manager.query(`DELETE FROM thread_reads WHERE member_id = $1 AND chat_id IN (${roots})`, [
    memberId,
    roomId,
  ]);
  await manager.query(`DELETE FROM pins WHERE member_id = $1 AND room_id = $2`, [memberId, roomId]);
};

/**
 * Drops a (just removed) member from every room, promoting a new owner where they owned one.
 * Returns who must hear about it: undefined = the whole workspace (a public room changed),
 * else the members of the affected private rooms. Call under `lockRooms`.
 */
export const leaveAllRooms = async (
  manager: EntityManager,
  memberId: string,
): Promise<{ changed: boolean; audience: string[] | undefined }> => {
  const rooms = returnedRows<{ room_id: string; role: string; is_private: boolean }>(
    await manager.query(
      `DELETE FROM room_members rm USING rooms r
       WHERE rm.member_id = $1 AND r.id = rm.room_id
       RETURNING rm.room_id, rm.role, r.is_private`,
      [memberId],
    ),
  );
  if (!rooms.length) return { changed: false, audience: [] };
  let anyPublic = false;
  const audience = new Set<string>();
  for (const room of rooms) {
    await dropRoomState(manager, memberId, room.room_id);
    if (room.role === 'owner') await promoteRoomOwner(manager, room.room_id);
    if (!room.is_private) anyPublic = true;
    else for (const id of await roomMemberIds(manager, room.room_id)) audience.add(id);
  }
  return { changed: true, audience: anyPublic ? undefined : [...audience] };
};

/** Live (not removed) human members of a room, oldest membership first. */
export const roomMemberIds = async (manager: EntityManager, roomId: string): Promise<string[]> =>
  returnedRows<{ member_id: string }>(
    await manager.query(
      `SELECT rm.member_id
       FROM room_members rm JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
       WHERE rm.room_id = $1
       ORDER BY rm.created_at ASC, rm.id ASC`,
      [roomId],
    ),
  ).map((row) => row.member_id);

/** Live (not deleted) agents of a room. */
export const roomAgentIds = async (manager: EntityManager, roomId: string): Promise<string[]> =>
  returnedRows<{ agent_id: string }>(
    await manager.query(
      `SELECT rm.agent_id
       FROM room_members rm JOIN agents a ON a.id = rm.agent_id AND a.deleted_at IS NULL
       WHERE rm.room_id = $1
       ORDER BY rm.created_at ASC, rm.id ASC`,
      [roomId],
    ),
  ).map((row) => row.agent_id);

/**
 * A new member joins the workspace's default channel(s) (`rooms.is_default`) and every connection inbox. Runs on the caller's manager
 * (inside the invite-accept transaction). Idempotent.
 */
export const joinDefaultRooms = async (
  manager: EntityManager,
  workspaceId: string,
  memberId: string,
): Promise<void> => {
  await manager.query(
    `INSERT INTO room_members (workspace_id, room_id, member_id, role)
     SELECT r.workspace_id, r.id, $2, 'member'
     FROM rooms r
     WHERE r.workspace_id = $1 AND r.kind = 'channel' AND r.is_private = false
       AND (r.connection_id IS NOT NULL OR r.is_default = true)
     ON CONFLICT DO NOTHING`,
    [workspaceId, memberId],
  );
};

/**
 * The rooms a member may open: their DMs (with a live agent), the channels they belong to and
 * every connection inbox. Same set `GET /rooms` lists.
 */
export const accessibleRoomIds = async (
  manager: EntityManager,
  workspaceId: string,
  memberId: string,
): Promise<string[]> =>
  returnedRows<{ id: string }>(
    await manager.query(
      `SELECT r.id FROM rooms r
       WHERE r.workspace_id = $1 AND (
         (r.kind = 'dm' AND r.member_id = $2
            AND EXISTS (SELECT 1 FROM agents a WHERE a.id = r.agent_id AND a.deleted_at IS NULL))
         OR (r.kind = 'channel' AND r.connection_id IS NOT NULL)
         OR (r.kind = 'channel' AND r.connection_id IS NULL
            AND EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.member_id = $2))
       )`,
      [workspaceId, memberId],
    ),
  ).map((row) => row.id);
