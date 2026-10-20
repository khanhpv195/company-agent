import { NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { returnedRows } from '../../common/utils';
import { Department } from './entities/department.entity';

/** A live (not deleted) department of the workspace; foreign, deleted or malformed ids are a 404. */
export const findLiveDepartment = async (
  manager: EntityManager,
  workspaceId: string,
  id: string,
): Promise<Department> => {
  const department = isUUID(id)
    ? await manager.findOne(Department, { where: { id, workspaceId } })
    : null;
  if (!department) throw new NotFoundException({ message: 'departments.NOT_FOUND' });
  return department;
};

/**
 * Adds a member or an agent to the department's room (idempotent) and never takes them out of
 * another room. Returns whether a membership was added. A department whose room is gone adds
 * nothing. The caller holds `lockRooms` where it can, so the room is not deleted underneath;
 * the insert selects from `rooms` anyway, so a vanished room adds nothing instead of failing.
 */
export const joinDepartmentRoom = async (
  manager: EntityManager,
  department: Pick<Department, 'workspaceId' | 'roomId'>,
  party: { memberId: string } | { agentId: string },
): Promise<boolean> => {
  if (!department.roomId) return false;
  const column = 'memberId' in party ? 'member_id' : 'agent_id';
  const id = 'memberId' in party ? party.memberId : party.agentId;
  const rows = returnedRows<{ id: string }>(
    await manager.query(
      `INSERT INTO room_members (workspace_id, room_id, ${column}, role, created_at)
       SELECT r.workspace_id, r.id, $3, 'member', clock_timestamp()
       FROM rooms r WHERE r.id = $2 AND r.workspace_id = $1
       ON CONFLICT DO NOTHING RETURNING id`,
      [department.workspaceId, department.roomId, id],
    ),
  );
  return rows.length > 0;
};
