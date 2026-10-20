import { Logger } from '@nestjs/common';
import type { DepartmentIcon } from '@repo/shared';
import { ILike, type DataSource } from 'typeorm';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { Room } from '../../modules/chat/entities/room.entity';
import { joinDepartmentRoom } from '../../modules/departments/department-access';
import { departmentRoomSlug } from '../../modules/departments/department-slug.util';
import { Department } from '../../modules/departments/entities/department.entity';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const OWNER_EMAIL = 'khanhpv@holatech.tech';

const DEPARTMENTS: {
  name: string;
  icon: DepartmentIcon;
  members: { email: string; title: string }[];
  agents: { name: string; title: string }[];
}[] = [
  {
    name: 'Kinh doanh',
    icon: 'chart',
    members: [{ email: 'hang@holatech.tech', title: 'Nhân viên Kinh doanh' }],
    agents: [
      { name: "khanhpv's Claude", title: 'Trợ lý bán hàng' },
      { name: 'Research Bot', title: 'Nghiên cứu thị trường' },
    ],
  },
  {
    name: 'Kỹ thuật',
    icon: 'terminal',
    members: [{ email: 'minh@holatech.tech', title: 'Trưởng nhóm Kỹ thuật' }],
    agents: [{ name: 'Deployer', title: 'Kỹ sư triển khai' }],
  },
];

/** Job titles of people who belong to no department. */
const OWNER_TITLE = 'Giám đốc';

/**
 * Departments `Kinh doanh` and `Kỹ thuật` of the `khanhpv` workspace, each with its public
 * channel, plus the people and agents assigned to them. Idempotent, and like the chat seed it
 * runs on every dev start: once the workspace has had departments they belong to the users, so
 * nothing is recreated or reassigned.
 */
export const seedDepartments = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:departments');
  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    const workspaceId = workspace.id;
    if (await manager.exists(Department, { where: { workspaceId }, withDeleted: true })) return;

    const owner = await manager.findOne(Member, { where: { workspaceId, email: OWNER_EMAIL } });
    if (!owner) {
      logger.warn(`Member ${OWNER_EMAIL} not found, run the auth seed first`);
      return;
    }
    if (!owner.title) await manager.update(Member, { id: owner.id }, { title: OWNER_TITLE });

    for (const [rank, data] of DEPARTMENTS.entries()) {
      const roomName = departmentRoomSlug(data.name);
      let room = await manager.findOne(Room, {
        where: { workspaceId, kind: 'channel', name: ILike(roomName) },
      });
      if (!room) {
        room = await manager.save(
          manager.create(Room, {
            workspaceId,
            kind: 'channel',
            name: roomName,
            icon: 'users',
            isPrivate: false,
            agentId: null,
            memberId: null,
            connectionId: null,
          }),
        );
        await manager.query(
          `INSERT INTO room_members (workspace_id, room_id, member_id, role)
           VALUES ($1, $2, $3, 'owner') ON CONFLICT DO NOTHING`,
          [workspaceId, room.id, owner.id],
        );
      }
      const department = await manager.save(
        manager.create(Department, {
          workspaceId,
          name: data.name,
          icon: data.icon,
          rank,
          roomId: room.id,
          templateId: null,
        }),
      );
      logger.log(`Created department ${data.name}`);

      for (const item of data.members) {
        const member = await manager.findOne(Member, { where: { workspaceId, email: item.email } });
        if (!member) continue;
        await manager.update(
          Member,
          { id: member.id },
          { departmentId: department.id, title: member.title ?? item.title },
        );
        await joinDepartmentRoom(manager, department, { memberId: member.id });
      }
      for (const item of data.agents) {
        const agent = await manager.findOne(Agent, { where: { workspaceId, name: item.name } });
        if (!agent) continue;
        await manager.update(
          Agent,
          { id: agent.id },
          { departmentId: department.id, title: agent.title ?? item.title },
        );
        await joinDepartmentRoom(manager, department, { agentId: agent.id });
      }
    }
  });
};
