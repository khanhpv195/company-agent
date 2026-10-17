import type { EntityManager } from 'typeorm';
import { Room } from '../chat/entities/room.entity';
import { Thread } from '../chat/entities/thread.entity';
import type { WorkspaceConnection } from './entities/workspace-connection.entity';

/** Threads cascade with the room; their messages and read marks have no foreign key. */
export async function deleteConnectionRoom(
  manager: EntityManager,
  workspaceId: string,
  roomId: string,
): Promise<void> {
  const threads = await manager.findBy(Thread, { workspaceId, roomId });
  const chatIds = threads.map((thread) => thread.id);
  if (chatIds.length) {
    await manager.query(
      `DELETE FROM messages WHERE workspace_id = $1 AND chat_id = ANY($2::uuid[])`,
      [workspaceId, chatIds],
    );
    await manager.query(`DELETE FROM thread_reads WHERE chat_id = ANY($1::uuid[])`, [chatIds]);
  }
  await manager.delete(Room, { id: roomId, workspaceId });
}

/** Turns a connection off: its inbox room is deleted and the account detached. */
export async function turnConnectionOff(
  manager: EntityManager,
  existing: WorkspaceConnection,
): Promise<WorkspaceConnection> {
  if (existing.roomId) await deleteConnectionRoom(manager, existing.workspaceId, existing.roomId);
  existing.status = 'off';
  existing.account = null;
  existing.roomId = null;
  existing.connectedAt = null;
  return manager.save(existing);
}
