import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Message } from '@repo/shared';
import { withStreamedText } from '../chat/chat.mapper';
import { ChatService } from '../chat/chat.service';
import { ASSIGNMENT_ENDED_EVENT, type AssignmentEndedPayload } from '../events';
import type { Assignment } from '../gateway/entities/assignment.entity';

/** Streamed text is published at most once per this many milliseconds and assignment. */
export const STREAM_PUBLISH_MS = 100;
/** A long reply is republished in full on every flush, so it flushes less often. */
export const STREAM_PUBLISH_LONG_MS = 500;
const LONG_TEXT_CHARS = 20_000;
/** A reply longer than this is cut (the buffer lives in memory). */
const MAX_BUFFER_CHARS = 400_000;

interface StreamState {
  workspaceId: string;
  messageId: string;
  text: string;
  /** Last published message with its assignment state; its markdown is replaced when sending. */
  base: Message | null;
  memberIds: string[] | undefined;
  lastPublishedAt: number;
  timer?: NodeJS.Timeout;
}

/**
 * Chat replies of real daemons stream from memory: text deltas accumulate here and go out as
 * (throttled) `message.upserted` events to the chat's audience, exactly like the simulator's
 * chunks; nothing is written to the database until the result arrives. Lost on a restart,
 * which is fine: the lease of an interrupted run expires and its message fails.
 */
@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger(ChatStreamService.name);
  private readonly streams = new Map<string, StreamState>();
  /** Assignments that ended recently: a slow, stale "streaming" publish must not follow them. */
  private readonly ended = new Set<string>();

  constructor(private readonly chat: ChatService) {
    // A stopped reply keeps the text streamed so far.
    chat.registerPartialTextSource((assignmentId) => this.streams.get(assignmentId)?.text);
  }

  @OnEvent(ASSIGNMENT_ENDED_EVENT)
  onAssignmentEnded(payload: AssignmentEndedPayload): void {
    if (payload.sourceKind !== 'chat') return;
    this.discard(payload.assignmentId);
    this.ended.add(payload.assignmentId);
    setTimeout(() => this.ended.delete(payload.assignmentId), 60_000).unref();
  }

  /** The text streamed so far (what the final message falls back to). */
  textOf(assignmentId: string): string {
    return this.streams.get(assignmentId)?.text ?? '';
  }

  discard(assignmentId: string): void {
    const state = this.streams.get(assignmentId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    this.streams.delete(assignmentId);
  }

  /** Appends a delta and publishes it, at most once per `STREAM_PUBLISH_MS`. */
  append(assignment: Pick<Assignment, 'id' | 'workspaceId' | 'sourceId'>, delta: string): void {
    if (!delta || this.ended.has(assignment.id)) return;
    let state = this.streams.get(assignment.id);
    if (!state) {
      state = {
        workspaceId: assignment.workspaceId,
        messageId: assignment.sourceId,
        text: '',
        base: null,
        memberIds: undefined,
        lastPublishedAt: 0,
      };
      this.streams.set(assignment.id, state);
    }
    if (state.text.length < MAX_BUFFER_CHARS) {
      state.text = (state.text + delta).slice(0, MAX_BUFFER_CHARS);
    }
    const interval =
      state.text.length > LONG_TEXT_CHARS ? STREAM_PUBLISH_LONG_MS : STREAM_PUBLISH_MS;
    const wait = state.lastPublishedAt + interval - Date.now();
    if (wait <= 0) {
      void this.flush(assignment.id);
    } else if (!state.timer) {
      state.timer = setTimeout(() => void this.flush(assignment.id), wait);
      state.timer.unref();
    }
  }

  /**
   * Publishes the message now with its fresh assignment state (status, tool calls, turns);
   * a reply that is still streaming carries the text accumulated so far.
   */
  async publishNow(assignmentId: string): Promise<void> {
    try {
      const context = await this.chat.replyContext(assignmentId);
      if (!context) return;
      const message = await this.chat.loadMessage(context.message.id);
      if (message.status === 'streaming' && this.ended.has(assignmentId)) return;
      // A deleted message keeps no text, not even the streamed one.
      if (message.deleted) this.discard(assignmentId);
      const state = this.streams.get(assignmentId);
      if (state) {
        state.base = message;
        state.memberIds = context.memberIds;
        state.lastPublishedAt = Date.now();
      }
      this.chat.publishMessage(
        context.assignment.workspaceId,
        state && message.status === 'streaming' && !message.deleted
          ? withStreamedText(message, state.text)
          : message,
        context.memberIds,
      );
    } catch (error) {
      this.logger.warn(
        `Publishing chat reply ${assignmentId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async flush(assignmentId: string): Promise<void> {
    const state = this.streams.get(assignmentId);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    state.lastPublishedAt = Date.now();
    if (!state.base) {
      await this.publishNow(assignmentId);
      return;
    }
    // The audience is re-read on every flush: a member removed from a private room mid-reply
    // must stop receiving chunks (a cheap two-query lookup, at most 10 per second and stream).
    try {
      const current = await this.chat.currentAudience(state.base.roomId ?? '');
      if (!current || !this.streams.has(assignmentId) || state.base.deleted) return;
      state.memberIds = current.audience;
      this.chat.publishMessage(
        state.workspaceId,
        withStreamedText(state.base, state.text),
        current.audience,
      );
    } catch (error) {
      // Never fall back to the stale audience: skip this chunk, the next flush retries.
      this.logger.warn(
        `Resolving the audience of chat reply ${assignmentId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
