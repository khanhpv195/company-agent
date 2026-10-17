import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { RealtimeEvent } from '@repo/shared';
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

@Injectable()
export class EventsService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EventsService.name);
  /** Open SSE streams; each entry ends its stream and clears its heartbeat timer. */
  private readonly streams = new Set<() => void>();

  constructor(private readonly emitter: EventEmitter2) {}

  /** Registers an open SSE stream so shutdown can end it; returns the unregister function. */
  registerStream(end: () => void): () => void {
    this.streams.add(end);
    return () => void this.streams.delete(end);
  }

  get openStreamCount(): number {
    return this.streams.size;
  }

  /** `app.close()` waits for open connections, so end every SSE stream first. */
  beforeApplicationShutdown(): void {
    for (const end of [...this.streams]) {
      try {
        end();
      } catch (error) {
        this.logger.warn(`Failed to end SSE stream: ${String(error)}`);
      }
    }
    this.streams.clear();
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
