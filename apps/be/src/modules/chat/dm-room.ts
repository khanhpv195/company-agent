import type { EntityManager } from 'typeorm';
import { returnedRows } from '../../common/utils';
import { Room } from './entities/room.entity';

export interface DmRoomInput {
  workspaceId: string;
  memberId: string;
  agent: { id: string; name: string };
  now: Date;
}

/**
 * Gets or creates the DM of a member with an agent. Race-safe without retries: the insert
 * relies on the unique partial index (member, agent) for DMs and ignores a conflict, then the
 * existing row is read back. Runs on the caller's manager, so inside a transaction the room
 * is created (or rolled back) together with the caller's other writes.
 */
export const ensureDmRoom = async (
  manager: EntityManager,
  input: DmRoomInput,
): Promise<{ id: string; created: boolean }> => {
  const inserted = returnedRows<{ id: string }>(
    await manager.query(
      `INSERT INTO rooms (workspace_id, kind, name, icon, is_private, agent_id, member_id, created_at)
       VALUES ($1, 'dm', $2, 'users', true, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.workspaceId, input.agent.name, input.agent.id, input.memberId, input.now],
    ),
  );
  if (inserted.length) return { id: inserted[0].id, created: true };
  const existing = await manager.findOneByOrFail(Room, {
    workspaceId: input.workspaceId,
    kind: 'dm',
    memberId: input.memberId,
    agentId: input.agent.id,
  });
  return { id: existing.id, created: false };
};
