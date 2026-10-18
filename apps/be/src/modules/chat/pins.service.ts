import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PinItem, PinTargetType } from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects } from '../../common/utils';
import { EventsService } from '../events';
import { MAX_PINS } from './chat.constants';
import { threadNameOf } from './chat.mapper';
import { previewOf } from './chat.util';
import { ChatMessage } from './entities/chat-message.entity';
import { MessageStore } from './message-store.service';
import { accessibleRoomIds } from './room-access';

interface PinRow {
  id: string;
  target_type: PinTargetType;
  target_id: string;
  room_id: string;
  position: number;
}

/**
 * Per-member pins (Kylon "priorities"): a room, a thread (its root message id) or a message,
 * ordered by `position`. Listing resolves titles and silently skips targets the member can no
 * longer open (left room, deleted message); the pin rows stay until the room goes away.
 */
@Injectable()
export class PinsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventsService,
    private readonly store: MessageStore,
  ) {}

  async list(auth: AuthContext): Promise<PinItem[]> {
    const { items, hidden } = await this.resolve(this.dataSource.manager, auth);
    await this.prune(this.dataSource.manager, auth, hidden);
    return items;
  }

  /** Drops pins the member can no longer see (they would count against the cap unseen). */
  private async prune(manager: EntityManager, auth: AuthContext, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await manager.query(`DELETE FROM pins WHERE member_id = $1 AND id = ANY($2::uuid[])`, [
      auth.memberId,
      ids,
    ]);
  }

  async create(auth: AuthContext, targetType: PinTargetType, targetId: string): Promise<PinItem> {
    const pinId = await transactionWithEffects(this.dataSource, async (manager) => {
      const target = await this.checkTarget(manager, auth, targetType, targetId);
      // One member's pins change one at a time (the cap and the position).
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `pins:${auth.memberId}`,
      ]);
      const existing = returnedRows<{ id: string }>(
        await manager.query(
          `SELECT id FROM pins WHERE member_id = $1 AND target_type = $2 AND target_id = $3`,
          [auth.memberId, targetType, target.id],
        ),
      )[0];
      if (existing) return existing.id;
      await this.prune(manager, auth, (await this.resolve(manager, auth)).hidden);
      const count = returnedRows<{ n: string; next: number }>(
        await manager.query(
          `SELECT count(*) AS n, coalesce(max(position), -1) + 1 AS next FROM pins WHERE member_id = $1`,
          [auth.memberId],
        ),
      )[0];
      if (Number(count.n) >= MAX_PINS) throw new ConflictException({ message: 'chat.PINS_LIMIT' });
      const inserted = returnedRows<{ id: string }>(
        await manager.query(
          `INSERT INTO pins (member_id, workspace_id, target_type, target_id, room_id, position)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [auth.memberId, auth.workspaceId, targetType, target.id, target.roomId, count.next],
        ),
      );
      return inserted[0].id;
    });
    this.changed(auth);
    const item = (await this.list(auth)).find((pin) => pin.id === pinId);
    if (!item) throw new NotFoundException({ message: 'chat.PIN_TARGET_NOT_FOUND' });
    return item;
  }

  /** Removes the caller's pin; an unknown (or foreign) id is a silent no-op. */
  async remove(auth: AuthContext, id: string): Promise<null> {
    if (!isUUID(id)) return null;
    const removed = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM pins WHERE id = $1 AND member_id = $2 RETURNING id`,
        [id, auth.memberId],
      ),
    );
    if (removed.length) this.changed(auth);
    return null;
  }

  /** The listed pins first, in the given order; the others follow in their old order. */
  async reorder(auth: AuthContext, ids: string[]): Promise<PinItem[]> {
    await transactionWithEffects(this.dataSource, async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `pins:${auth.memberId}`,
      ]);
      const mine = returnedRows<{ id: string }>(
        await manager.query(
          `SELECT id FROM pins WHERE member_id = $1 ORDER BY position, created_at, id`,
          [auth.memberId],
        ),
      ).map((row) => row.id);
      const known = new Set(mine);
      if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
        throw new BadRequestException({ message: 'chat.PIN_ORDER_INVALID' });
      }
      const order = [...ids, ...mine.filter((id) => !ids.includes(id))];
      await manager.query(
        `UPDATE pins SET position = t.pos - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, pos)
         WHERE pins.id = t.id AND pins.member_id = $2`,
        [order, auth.memberId],
      );
    });
    this.changed(auth);
    return this.list(auth);
  }

  private changed(auth: AuthContext): void {
    this.events.publish(auth.workspaceId, { type: 'pins.changed' }, { memberIds: [auth.memberId] });
  }

  /** The pin target as the caller may open it; anything else is 404. Threads are pinned by root. */
  private async checkTarget(
    manager: EntityManager,
    auth: AuthContext,
    type: PinTargetType,
    id: string,
  ): Promise<{ id: string; roomId: string }> {
    const notFound = () => new NotFoundException({ message: 'chat.PIN_TARGET_NOT_FOUND' });
    if (type === 'room') {
      const scope = await this.store.resolveRoom(manager, auth, id);
      return { id: scope.room.id, roomId: scope.room.id };
    }
    const row = isUUID(id)
      ? await manager.findOneBy(ChatMessage, { id, workspaceId: auth.workspaceId })
      : null;
    if (!row || row.deletedAt || row.systemRoot) throw notFound();
    const scope = await this.store.resolveRoom(manager, auth, row.roomId);
    if (await this.store.rootDeleted(manager, row)) throw notFound();
    if (type === 'thread') {
      const root = await this.store.resolveRoot(manager, scope.room, row.id);
      return { id: root.id, roomId: scope.room.id };
    }
    return { id: row.id, roomId: scope.room.id };
  }

  private async resolve(
    manager: EntityManager,
    auth: AuthContext,
  ): Promise<{ items: PinItem[]; hidden: string[] }> {
    const pins = returnedRows<PinRow>(
      await manager.query(
        `SELECT id, target_type, target_id, room_id, position FROM pins
         WHERE member_id = $1 ORDER BY position, created_at, id`,
        [auth.memberId],
      ),
    );
    if (!pins.length) return { items: [], hidden: [] };
    const open = new Set(await accessibleRoomIds(manager, auth.workspaceId, auth.memberId));
    const visible = pins.filter((pin) => open.has(pin.room_id));
    if (!visible.length) return { items: [], hidden: pins.map((pin) => pin.id) };
    const rooms = new Map(
      returnedRows<{ id: string; name: string; kind: 'dm' | 'channel' }>(
        await manager.query(`SELECT id, name, kind FROM rooms WHERE id = ANY($1::uuid[])`, [
          [...new Set(visible.map((pin) => pin.room_id))],
        ]),
      ).map((room) => [room.id, room]),
    );
    const messages = new Map(
      (
        await manager
          .createQueryBuilder(ChatMessage, 'm')
          .where('m.id IN (:...ids)', {
            ids: visible
              .filter((pin) => pin.target_type !== 'room')
              .map((pin) => pin.target_id)
              .concat(['00000000-0000-0000-0000-000000000000']),
          })
          .andWhere('m.deleted_at IS NULL AND NOT m.system_root')
          .getMany()
      ).map((row) => [row.id, row]),
    );
    const rootGone = new Set(
      returnedRows<{ id: string }>(
        await manager.query(
          `SELECT m.id FROM messages m JOIN messages root ON root.id = m.parent_id
           WHERE m.id = ANY($1::uuid[]) AND root.deleted_at IS NOT NULL`,
          [[...messages.keys()]],
        ),
      ).map((row) => row.id),
    );
    const items: PinItem[] = [];
    for (const pin of visible) {
      const room = rooms.get(pin.room_id);
      if (!room) continue;
      const base = {
        id: pin.id,
        targetType: pin.target_type,
        targetId: pin.target_id,
        roomId: room.id,
        roomName: room.name,
        roomKind: room.kind,
        position: pin.position,
      };
      if (pin.target_type === 'room') {
        items.push({ ...base, title: room.name, messageId: null, threadRootId: null });
        continue;
      }
      const message = messages.get(pin.target_id);
      if (!message || rootGone.has(message.id) || message.roomId !== room.id) continue;
      if (pin.target_type === 'thread') {
        if (message.parentId) continue;
        items.push({
          ...base,
          title: threadNameOf(message, previewOf),
          messageId: message.id,
          threadRootId: message.id,
        });
      } else {
        items.push({
          ...base,
          title: previewOf(message.markdown).trim().slice(0, 120),
          messageId: message.id,
          threadRootId: message.parentId,
        });
      }
    }
    const shown = new Set(items.map((item) => item.id));
    return { items, hidden: pins.filter((pin) => !shown.has(pin.id)).map((pin) => pin.id) };
  }
}
