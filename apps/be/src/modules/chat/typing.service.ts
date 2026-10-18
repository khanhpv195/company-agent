import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { returnedRows } from '../../common/utils';
import { EventsService } from '../events';
import { TYPING_THROTTLE_MS } from './chat.constants';
import { MessageStore } from './message-store.service';

const PRUNE_ABOVE = 2000;

/**
 * "Someone is typing": an ephemeral `presence.typing` event to the room's audience except the
 * sender. Nothing is stored; a member's repeats in the same room (thread) inside
 * `TYPING_THROTTLE_MS` are dropped (in memory, per process).
 */
@Injectable()
export class TypingService {
  private readonly last = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly store: MessageStore,
  ) {}

  async typing(auth: AuthContext, roomId: string, parentId?: string): Promise<null> {
    const manager = this.dataSource.manager;
    const scope = await this.store.resolveRoom(manager, auth, roomId);
    const parent = parentId
      ? (await this.store.resolveRoot(manager, scope.room, parentId)).id
      : null;
    const now = this.clock.now().getTime();
    const key = `${auth.memberId}:${scope.room.id}:${parent ?? ''}`;
    const before = this.last.get(key);
    if (before !== undefined && now - before < TYPING_THROTTLE_MS && now >= before) return null;
    this.last.set(key, now);
    if (this.last.size > PRUNE_ABOVE) {
      for (const [k, at] of this.last) if (now - at >= TYPING_THROTTLE_MS) this.last.delete(k);
    }
    const name = returnedRows<{ name: string }>(
      await manager.query(`SELECT name FROM members WHERE id = $1`, [auth.memberId]),
    )[0]?.name;
    // An inbox is visible to the whole workspace: its audience is every live member.
    const audience =
      scope.audience ??
      returnedRows<{ id: string }>(
        await manager.query(
          `SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL`,
          [auth.workspaceId],
        ),
      ).map((row) => row.id);
    const to = audience.filter((id) => id !== auth.memberId);
    if (!to.length) return null;
    this.events.publish(
      auth.workspaceId,
      {
        type: 'presence.typing',
        roomId: scope.room.id,
        parentId: parent,
        memberId: auth.memberId,
        name: name ?? '',
      },
      { memberIds: to },
    );
    return null;
  }
}
