import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PresenceEntry, PresenceStatus, RealtimeEvent } from '@repo/shared';
import type { AssignmentSourceKind, AssignmentStatus } from '../gateway/entities/assignment.entity';

/** Client-facing events, consumed by the SSE endpoint (Phase 3). */
export const REALTIME_EVENT = 'realtime';
/** Internal domain events, never sent to clients. */
export const ASSIGNMENT_ENDED_EVENT = 'assignment.ended';
export const ASSIGNMENT_PROGRESS_EVENT = 'assignment.progress';

export interface RealtimeEnvelope {
  workspaceId: string;
  event: RealtimeEvent;
  /**
   * When set, only these members of the workspace receive the event (private DMs). The SSE
   * stream is fail-closed: with this field present, anybody not listed (also with an empty
   * list) is skipped.
   */
  memberIds?: readonly string[];
}

export interface PublishOptions {
  memberIds?: readonly string[];
}

export interface AssignmentEndedPayload {
  workspaceId: string;
  assignmentId: string;
  sourceKind: AssignmentSourceKind;
  sourceId: string;
  agentId: string;
  status: AssignmentStatus;
}

export interface AssignmentProgressPayload {
  workspaceId: string;
  assignmentId: string;
  agentId: string;
  events: { kind: 'tool' | 'text' | 'step'; payload?: unknown }[];
}

/** A member whose last stream closed stays "online" this long (reconnects, token refresh) before going offline. */
export const PRESENCE_OFFLINE_DELAY_MS = 5000;

interface PresenceState {
  workspaceId: string;
  /** What was last announced. */
  published: PresenceStatus;
  timer?: NodeJS.Timeout;
}

export interface StreamOwner {
  memberId?: string;
  workspaceId?: string;
  sessionId?: string;
}

@Injectable()
export class EventsService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EventsService.name);
  /** Open SSE streams; each entry ends its stream and clears its heartbeat timer. */
  private readonly streams = new Map<() => void, { owner: StreamOwner; idle: boolean }>();

  /** Presence per member, derived from the open streams (`presence.update` on changes). */
  private readonly presence = new Map<string, PresenceState>();
  /** Tests lower this; see `PRESENCE_OFFLINE_DELAY_MS`. */
  presenceOfflineDelayMs = PRESENCE_OFFLINE_DELAY_MS;

  constructor(private readonly emitter: EventEmitter2) {}

  /** Registers an open SSE stream so shutdown can end it; returns the unregister function. */
  registerStream(end: () => void, owner: StreamOwner = {}): () => void {
    // A new stream starts active, also when the member reconnects while idle.
    this.streams.set(end, { owner, idle: false });
    this.syncPresence(owner);
    return () => {
      if (this.streams.delete(end)) this.syncPresence(owner);
    };
  }

  /** Members with an open stream of this workspace: online, or idle when their client said so. */
  presenceSnapshot(workspaceId: string): PresenceEntry[] {
    const entries: PresenceEntry[] = [];
    for (const [memberId, state] of this.presence) {
      if (state.workspaceId === workspaceId && state.published !== 'offline') {
        entries.push({ memberId, status: state.published });
      }
    }
    return entries;
  }

  /**
   * A client reports idle or active again. Idle is tracked per stream: it applies to the
   * member's streams of that login (`sessionId`; all their streams when unknown), and the member
   * is idle only when every open stream is. Ignored without an open stream.
   */
  setIdle(workspaceId: string, memberId: string, idle: boolean, sessionId?: string): void {
    let matched = false;
    for (const stream of this.streams.values()) {
      const { owner } = stream;
      if (owner.memberId !== memberId || owner.workspaceId !== workspaceId) continue;
      if (sessionId && owner.sessionId && owner.sessionId !== sessionId) continue;
      stream.idle = idle;
      matched = true;
    }
    if (matched) this.syncPresence({ memberId, workspaceId });
  }

  /** The member has an open stream: `idle` when all of them are idle, else `online`. */
  private streamStatus(memberId: string): PresenceStatus | null {
    let open = false;
    for (const { owner, idle } of this.streams.values()) {
      if (owner.memberId !== memberId) continue;
      if (!idle) return 'online';
      open = true;
    }
    return open ? 'idle' : null;
  }

  private hasStream(memberId: string): boolean {
    return this.streamStatus(memberId) !== null;
  }

  /** Announces a member's presence when it changed; going offline waits out the debounce. */
  private syncPresence(owner: StreamOwner): void {
    const { memberId, workspaceId } = owner;
    if (!memberId || !workspaceId) return;
    const state = this.presence.get(memberId) ?? {
      workspaceId,
      published: 'offline' as PresenceStatus,
    };
    this.presence.set(memberId, state);
    const open = this.streamStatus(memberId);
    if (open) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = undefined;
      const status: PresenceStatus = open;
      if (state.published !== status) {
        state.published = status;
        this.publish(workspaceId, { type: 'presence.update', memberId, status });
      }
      return;
    }
    if (state.published === 'offline') {
      this.presence.delete(memberId);
      return;
    }
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (this.hasStream(memberId)) return;
      this.presence.delete(memberId);
      this.publish(workspaceId, { type: 'presence.update', memberId, status: 'offline' });
    }, this.presenceOfflineDelayMs);
    state.timer.unref();
  }

  /**
   * Ends the open streams of a member (removal, password reset, revoked sessions). With
   * `exceptSessionId` the streams of that login stay open; with `onlySessionId` only that
   * login's streams end. Streams opened by tokens without a session id count as "other".
   */
  closeMemberStreams(
    memberId: string,
    filter: { exceptSessionId?: string; onlySessionId?: string } = {},
  ): void {
    for (const [end, { owner }] of [...this.streams]) {
      if (owner.memberId !== memberId) continue;
      if (filter.exceptSessionId && owner.sessionId === filter.exceptSessionId) continue;
      if (filter.onlySessionId && owner.sessionId !== filter.onlySessionId) continue;
      try {
        end();
      } catch (error) {
        this.logger.warn(`Failed to end SSE stream: ${String(error)}`);
      }
      this.streams.delete(end);
      this.syncPresence(owner);
    }
  }

  /** Ends every open stream of a workspace (the workspace was deleted). */
  closeWorkspaceStreams(workspaceId: string): void {
    for (const [end, { owner }] of [...this.streams]) {
      if (owner.workspaceId !== workspaceId) continue;
      try {
        end();
      } catch (error) {
        this.logger.warn(`Failed to end SSE stream: ${String(error)}`);
      }
      this.streams.delete(end);
      this.syncPresence(owner);
    }
  }

  get openStreamCount(): number {
    return this.streams.size;
  }

  /** `app.close()` waits for open connections, so end every SSE stream first. */
  beforeApplicationShutdown(): void {
    for (const end of [...this.streams.keys()]) {
      try {
        end();
      } catch (error) {
        this.logger.warn(`Failed to end SSE stream: ${String(error)}`);
      }
    }
    this.streams.clear();
    for (const state of this.presence.values()) if (state.timer) clearTimeout(state.timer);
    this.presence.clear();
  }

  publish(workspaceId: string, event: RealtimeEvent, options: PublishOptions = {}): void {
    const envelope: RealtimeEnvelope = { workspaceId, event };
    if (options.memberIds) envelope.memberIds = options.memberIds;
    this.safeEmit(REALTIME_EVENT, envelope);
  }

  emitAssignmentEnded(payload: AssignmentEndedPayload): void {
    this.safeEmit(ASSIGNMENT_ENDED_EVENT, payload);
  }

  emitAssignmentProgress(payload: AssignmentProgressPayload): void {
    this.safeEmit(ASSIGNMENT_PROGRESS_EVENT, payload);
  }

  /** Any other internal domain event (computer.offline, ...), never delivered to clients. */
  emitDomain(name: string, payload: object): void {
    this.safeEmit(name, payload);
  }

  /** Events fire after a commit: a throwing listener must never fail the caller. */
  private safeEmit(name: string, payload: unknown): void {
    try {
      this.emitter.emit(name, payload);
    } catch (error) {
      this.logger.error(
        `Listener for "${name}" threw`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
