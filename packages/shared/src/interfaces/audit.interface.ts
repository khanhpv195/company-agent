import type { CursorPageResponse } from './pagination.interface';

export interface AuditEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** `null` when the action had no member behind it. */
  actor: { id: string; name: string } | null;
  /** Dotted action name such as `auth.login` or `agent.created`. */
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
}

/**
 * `GET /audit-events?before=<cursor>&limit=<n>`: newest first, `data` is the events and
 * `meta.nextCursor` the opaque cursor for the next page (null at the end). The cursor encodes
 * the position `(created_at, id)`, so events sharing a timestamp are never skipped or repeated.
 */
export type AuditEventsResponse = CursorPageResponse<AuditEvent>;
