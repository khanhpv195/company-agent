import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Message } from '@repo/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects } from '../../common/utils';
import { EventsService } from '../events';
import { MessageStore } from './message-store.service';
import { isReactionKey, MAX_REACTION_KEYS } from './reaction-key';

/** Emoji reactions: `PUT` / `DELETE` are idempotent and publish only when something changed. */
@Injectable()
export class MessageReactionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventsService,
    private readonly store: MessageStore,
  ) {}

  set(auth: AuthContext, roomId: string, messageId: string, key: string): Promise<Message> {
    return this.change(auth, roomId, messageId, key, true);
  }

  unset(auth: AuthContext, roomId: string, messageId: string, key: string): Promise<Message> {
    return this.change(auth, roomId, messageId, key, false);
  }

  private async change(
    auth: AuthContext,
    roomId: string,
    messageId: string,
    key: string,
    add: boolean,
  ): Promise<Message> {
    if (!isReactionKey(key)) throw new BadRequestException({ message: 'chat.REACTION_INVALID' });
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const scope = await this.store.resolveRoom(manager, auth, roomId);
      const row = await this.store.requireMessage(manager, scope.room, messageId);
      // Nothing can be reacted to once it is deleted (or its thread root is).
      if (row.deletedAt || row.systemRoot || (await this.store.rootDeleted(manager, row))) {
        throw new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id: messageId } });
      }
      let changed: boolean;
      if (add) {
        // Serialize concurrent reactions to one message so the key cap holds.
        await manager.query(`SELECT 1 FROM messages WHERE id = $1 FOR UPDATE`, [row.id]);
        const exists = returnedRows<{ n: string }>(
          await manager.query(
            `SELECT count(*) AS n FROM message_reactions
             WHERE message_id = $1 AND member_id = $2 AND key = $3`,
            [row.id, auth.memberId, key],
          ),
        )[0];
        if (Number(exists?.n) === 0) {
          const keys = returnedRows<{ n: string }>(
            await manager.query(
              `SELECT count(DISTINCT key) AS n FROM message_reactions WHERE message_id = $1`,
              [row.id],
            ),
          )[0];
          const known = returnedRows<{ n: string }>(
            await manager.query(
              `SELECT count(*) AS n FROM message_reactions WHERE message_id = $1 AND key = $2`,
              [row.id, key],
            ),
          )[0];
          if (Number(known?.n) === 0 && Number(keys?.n) >= MAX_REACTION_KEYS) {
            throw new ConflictException({ message: 'chat.REACTIONS_LIMIT' });
          }
        }
        changed =
          returnedRows<{ id: string }>(
            await manager.query(
              `INSERT INTO message_reactions (workspace_id, message_id, member_id, key)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (message_id, member_id, key) DO NOTHING
               RETURNING id`,
              [auth.workspaceId, row.id, auth.memberId, key],
            ),
          ).length > 0;
      } else {
        changed =
          returnedRows<{ id: string }>(
            await manager.query(
              `DELETE FROM message_reactions
               WHERE message_id = $1 AND member_id = $2 AND key = $3 RETURNING id`,
              [row.id, auth.memberId, key],
            ),
          ).length > 0;
      }
      const message = await this.store.loadMessage(row.id, manager, auth.memberId);
      if (changed) {
        const shared = (await this.store.reactionsOf(manager, [row.id])).get(row.id) ?? [];
        effects.push(() =>
          this.events.publish(
            auth.workspaceId,
            {
              type: 'message.reactions_updated',
              roomId: row.roomId,
              messageId: row.id,
              parentId: row.parentId,
              reactions: shared,
            },
            { memberIds: scope.audience },
          ),
        );
      }
      return message;
    });
  }
}
