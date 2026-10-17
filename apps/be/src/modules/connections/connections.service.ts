import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Connection, ConnectionProvider } from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import { ClockService } from '../../common/clock';
import { opsConfig } from '../../config';
import type { AuthContext } from '../../common/types';
import { AUTHORIZE_DELAY_MS } from '../../contacts';
import { Agent } from '../agents/entities/agent.entity';
import { MessageStore } from '../chat/message-store.service';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { Room } from '../chat/entities/room.entity';
import { assertRoomNameFree, mapRoomNameConflict } from '../chat/room-access';
import { DashboardService } from '../dashboard/dashboard.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events';
import { TaskTimers } from '../tasks/task-timers';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import {
  CONNECTION_CATALOG,
  CONNECTION_SAMPLES,
  findDefinition,
  type ConnectionDefinition,
} from './connection-catalog';
import { turnConnectionOff } from './connection-room';
import type { ConnectDto } from './dto/connection.dto';
import { WorkspaceConnection } from './entities/workspace-connection.entity';

const toConnection = (
  definition: ConnectionDefinition,
  row: WorkspaceConnection | null | undefined,
  availability: Connection['availability'],
): Connection => ({
  ...definition,
  status: row?.status ?? 'off',
  account: row?.account ?? null,
  roomName: row?.roomName ?? definition.roomName,
  roomId: row?.roomId ?? null,
  agentId: row?.agentId ?? null,
  mode: row?.mode ?? 'draft',
  availability,
});

/**
 * Connections to Zalo, Facebook and Gmail, with OAuth simulated (`CONNECTIONS_MODE=simulated`;
 * `disabled` answers 409 `connections.UNAVAILABLE` to authorize and connect, disconnect still works): `authorize` only waits, and
 * `connect` creates the inbox room with one sample conversation (an external message and the
 * agent's draft reply). Nothing is exchanged with the providers yet.
 */
@Injectable()
export class ConnectionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lock: WorkspaceLockService,
    private readonly timers: TaskTimers,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly dashboard: DashboardService,
    private readonly audit: AuditService,
    private readonly store: MessageStore,
    @Inject(opsConfig.KEY) private readonly ops: ConfigType<typeof opsConfig>,
  ) {}

  private get availability(): Connection['availability'] {
    return this.ops.connectionsMode === 'simulated' ? 'simulated' : 'unavailable';
  }

  /** Provider OAuth is not implemented: with `CONNECTIONS_MODE=disabled` nothing can be turned on. */
  private assertAvailable(): void {
    if (this.availability === 'unavailable') {
      throw new ConflictException({ message: 'connections.UNAVAILABLE' });
    }
  }

  async list(workspaceId: string): Promise<Connection[]> {
    const rows = await this.dataSource.manager.findBy(WorkspaceConnection, { workspaceId });
    return CONNECTION_CATALOG.map((definition) =>
      toConnection(
        definition,
        rows.find((row) => row.provider === definition.id),
        this.availability,
      ),
    );
  }

  /** The OAuth consent screen of a real provider; here a fixed 1.5 s round trip. */
  async authorize(provider: string): Promise<{ ok: true }> {
    this.definition(provider);
    this.assertAvailable();
    await new Promise<void>((resolve) => this.timers.later(AUTHORIZE_DELAY_MS, resolve));
    return { ok: true };
  }

  /**
   * Turns the connection on. The room, its thread and the sample messages are created once;
   * connecting again (to change the account, agent, mode or room name) only updates settings.
   */
  connect(auth: AuthContext, provider: string, dto: ConnectDto): Promise<Connection> {
    const definition = this.definition(provider);
    this.assertAvailable();
    const { workspaceId, memberId } = auth;
    return this.lock
      .run(workspaceId, async (manager, effects) => {
        const agent = isUUID(dto.agentId)
          ? await manager.findOneBy(Agent, { id: dto.agentId, workspaceId })
          : null;
        if (!agent) throw new BadRequestException({ message: 'connections.UNKNOWN_AGENT' });
        const now = this.clock.now();
        const sample = CONNECTION_SAMPLES[definition.id];
        const roomName = dto.roomName.trim().replace(/^#/, '') || `${definition.id}-inbox`;
        const existing = await manager.findOneBy(WorkspaceConnection, {
          workspaceId,
          provider: definition.id,
        });

        let room = existing?.roomId
          ? await manager.findOneBy(Room, { id: existing.roomId, workspaceId })
          : null;
        if (room) {
          if (room.name !== roomName) {
            await assertRoomNameFree(manager, workspaceId, roomName, room.id);
            await manager.update(Room, { id: room.id }, { name: roomName });
          }
        } else {
          await assertRoomNameFree(manager, workspaceId, roomName, null);
          room = await manager.save(
            manager.create(Room, {
              workspaceId,
              kind: 'channel',
              name: roomName,
              icon: 'inbox',
              isPrivate: false,
              agentId: null,
              memberId: null,
              connectionId: definition.id,
              createdAt: now,
            }),
          );
          // Inboxes are open to the workspace: every live member plus the connection's agent.
          await manager.query(
            `INSERT INTO room_members (workspace_id, room_id, member_id, role)
           SELECT $1, $2, m.id, CASE WHEN m.id = $3 THEN 'owner' ELSE 'member' END
           FROM members m WHERE m.workspace_id = $1 AND m.removed_at IS NULL
           ON CONFLICT DO NOTHING`,
            [workspaceId, room.id, memberId],
          );
        }
        await manager.query(
          `DELETE FROM room_members WHERE room_id = $1 AND agent_id IS NOT NULL AND agent_id <> $2`,
          [room.id, agent.id],
        );
        await manager.query(
          `INSERT INTO room_members (workspace_id, room_id, agent_id, role)
         VALUES ($1, $2, $3, 'member') ON CONFLICT DO NOTHING`,
          [workspaceId, room.id, agent.id],
        );
        // The sample conversation: an external message (the thread root, titled after its
        // sender) and the agent's reply under it. Created once per inbox.
        let root = await manager.findOne(ChatMessage, {
          where: {
            workspaceId,
            roomId: room.id,
            parentId: IsNull(),
            externalConnectionId: definition.id,
          },
          order: { seq: 'ASC' },
        });
        const fresh = !root;
        if (!root) {
          root = await manager.save(
            manager.create(ChatMessage, {
              workspaceId,
              roomId: room.id,
              parentId: null,
              threadTitle: sample.from,
              authorKind: 'external',
              externalConnectionId: definition.id,
              externalName: sample.from,
              status: 'complete',
              markdown: sample.text,
              draft: null,
              createdAt: now,
            }),
          );
          const reply = await manager.save(
            manager.create(ChatMessage, {
              workspaceId,
              roomId: room.id,
              parentId: root.id,
              authorKind: 'agent',
              authorAgentId: agent.id,
              status: 'complete',
              markdown: sample.reply,
              // Real provider adapters plug in at `send-draft` (ChatService.sendDraft): today the
              // draft is only marked sent and nothing leaves the product.
              draft: {
                connectionId: definition.id,
                state: dto.mode === 'draft' ? 'pending' : 'sent',
              },
              createdAt: now,
            }),
          );
          await manager.update(ChatMessage, { id: root.id }, { replyCount: 1, lastReplyAt: now });
          const messages = await this.store.hydrate(
            manager,
            await manager.find(ChatMessage, {
              where: [{ id: root.id }, { id: reply.id }],
              order: { seq: 'ASC' },
              relations: { assignment: true },
            }),
          );
          for (const message of messages) {
            effects.push(() =>
              this.events.publish(workspaceId, { type: 'message.upserted', message }),
            );
          }
          await this.store.queueThreadUpdates(manager, effects, workspaceId, [root.id], undefined);
        }

        if (fresh) {
          await this.dashboard.recordFeed(
            manager,
            effects,
            workspaceId,
            memberId,
            `kết nối **${definition.name}** vào **#${roomName}**`,
          );
        }

        const row = await manager.save(
          manager.create(WorkspaceConnection, {
            workspaceId,
            provider: definition.id,
            status: 'on',
            account: dto.account,
            roomName,
            roomId: room.id,
            agentId: agent.id,
            mode: dto.mode,
            connectedAt:
              existing?.status === 'on' && existing.connectedAt ? existing.connectedAt : now,
          }),
        );
        effects.push(() => this.publishChanged(workspaceId));
        await this.audit.record(
          {
            workspaceId,
            actorMemberId: memberId,
            action: 'connection.connected',
            targetType: 'connection',
            targetId: definition.id,
            meta: { agentId: agent.id, mode: dto.mode },
            ip: auth.ip,
          },
          manager,
        );
        return toConnection(definition, row, this.availability);
      })
      .catch(mapRoomNameConflict);
  }

  /** Turns it off: the inbox room, its threads, messages and read marks are deleted. */
  disconnect(auth: AuthContext, provider: string): Promise<Connection> {
    const definition = this.definition(provider);
    const { workspaceId } = auth;
    return this.lock.run(workspaceId, async (manager, effects) => {
      const existing = await manager.findOneBy(WorkspaceConnection, {
        workspaceId,
        provider: definition.id,
      });
      if (!existing) return toConnection(definition, null, this.availability);
      const row = await turnConnectionOff(manager, existing);
      await this.audit.record(
        {
          workspaceId,
          actorMemberId: auth.memberId,
          action: 'connection.disconnected',
          targetType: 'connection',
          targetId: definition.id,
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.publishChanged(workspaceId));
      return toConnection(definition, row, this.availability);
    });
  }

  private publishChanged(workspaceId: string): void {
    this.events.publish(workspaceId, { type: 'connections.changed' });
    this.events.publish(workspaceId, { type: 'rooms.changed' });
  }

  private definition(provider: string): ConnectionDefinition & { id: ConnectionProvider } {
    const definition = findDefinition(provider);
    if (!definition) {
      throw new NotFoundException({ message: 'connections.NOT_FOUND', args: { id: provider } });
    }
    return definition;
  }
}
