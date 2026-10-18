import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { MentionFeedPage, MentionItem } from '@repo/shared';
import { DataSource, In } from 'typeorm';
import type { AuthContext } from '../../common/types';
import { returnedRows } from '../../common/utils';
import { ChatMessage } from './entities/chat-message.entity';
import { MessageStore } from './message-store.service';
import { accessibleRoomIds } from './room-access';

/** `GET /mentions`: the messages that mention the caller (or @here / @room) across their rooms. */
@Injectable()
export class MentionsFeedService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: MessageStore,
  ) {}

  async list(
    auth: AuthContext,
    query: { limit: number; before?: string },
  ): Promise<MentionFeedPage> {
    const manager = this.dataSource.manager;
    const roomIds = await accessibleRoomIds(manager, auth.workspaceId, auth.memberId);
    if (!roomIds.length) return { items: [], hasMore: false };
    const ids = returnedRows<{ id: string }>(
      await manager.query(
        `SELECT m.id, m.seq
         FROM messages m
         LEFT JOIN messages root ON root.id = m.parent_id
         WHERE m.room_id = ANY($1::uuid[]) AND m.deleted_at IS NULL AND NOT m.system_root
           AND (root.id IS NULL OR root.deleted_at IS NULL)
           AND NOT (m.author_kind = 'human' AND m.author_member_id = $2)
           AND EXISTS (SELECT 1 FROM message_mentions mm
                       WHERE mm.message_id = m.id AND (mm.member_id = $2 OR mm.kind = 'here'))
           AND ($3::bigint IS NULL OR m.seq < $3::bigint)
         ORDER BY m.seq DESC
         LIMIT $4`,
        [roomIds, auth.memberId, query.before ?? null, query.limit + 1],
      ),
    ).map((row) => row.id);
    const hasMore = ids.length > query.limit;
    const page = ids.slice(0, query.limit);
    if (!page.length) return { items: [], hasMore: false };
    const rows = await manager.find(ChatMessage, {
      where: { id: In(page) },
      relations: { assignment: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = page.map((id) => byId.get(id)).filter((row): row is ChatMessage => !!row);
    const messages = await this.store.hydrate(manager, ordered, auth.memberId);
    const rooms = new Map(
      returnedRows<{ id: string; name: string; kind: 'dm' | 'channel' }>(
        await manager.query(`SELECT id, name, kind FROM rooms WHERE id = ANY($1::uuid[])`, [
          [...new Set(ordered.map((row) => row.roomId))],
        ]),
      ).map((room) => [room.id, room]),
    );
    const roots = new Map(
      returnedRows<{ id: string; thread_title: string | null }>(
        await manager.query(`SELECT id, thread_title FROM messages WHERE id = ANY($1::uuid[])`, [
          [...new Set(ordered.map((row) => row.parentId).filter((id): id is string => !!id))],
        ]),
      ).map((root) => [root.id, root.thread_title]),
    );
    const items: MentionItem[] = messages.map((message, i) => {
      const row = ordered[i];
      const room = rooms.get(row.roomId);
      return {
        message,
        roomId: row.roomId,
        roomName: room?.name ?? '',
        roomKind: room?.kind ?? 'channel',
        threadRootId: row.parentId,
        threadTitle: row.parentId ? (roots.get(row.parentId) ?? null) : null,
      };
    });
    return { items, hasMore };
  }
}
