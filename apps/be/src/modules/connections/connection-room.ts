import type { EntityManager } from 'typeorm';
import { Room } from '../chat/entities/room.entity';
import type { WorkspaceConnection } from './entities/workspace-connection.entity';

/** The room's messages cascade with it (foreign key); its read marks have none, so they go first. */
export async function deleteConnectionRoom(
  manager: EntityManager,
  workspaceId: string,
  roomId: string,
): Promise<void> {
  await manager.query(
    `DELETE FROM thread_reads WHERE chat_id IN (SELECT id FROM messages WHERE room_id = $1)`,
    [roomId],
  );
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
