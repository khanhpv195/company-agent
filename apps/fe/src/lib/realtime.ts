import type { RealtimeEvent } from '@repo/shared';
import { reportApiReachable } from './connectivity';
import { API_URL, MOCK, refreshTokens, triggerSessionExpired } from './api-client';
import { getTokens } from './auth-tokens';

export interface RealtimeClient {
  subscribe(handler: (event: RealtimeEvent) => void): () => void;
}

export interface SseFrame {
  id?: string;
  data: string;
}

/**
 * Incremental text/event-stream parser. Feed it decoded chunks (which may split
 * anywhere, even mid-line or between CR and LF); it returns the frames completed so far.
 * Comment lines (`: ping`) and frames without `data:` are dropped.
 */
export class SseParser {
  private buffer = '';
  private skipLf = false;
  private dataLines: string[] = [];
  private id: string | undefined;

  push(chunk: string): SseFrame[] {
    const frames: SseFrame[] = [];
    let text = chunk;
    if (this.skipLf && text.startsWith('\n')) text = text.slice(1);
    this.skipLf = false;
    this.buffer += text;

    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== '\n' && ch !== '\r') continue;
      const line = this.buffer.slice(start, i);
      if (ch === '\r') {
        if (this.buffer[i + 1] === '\n') i++;
        else if (i + 1 === this.buffer.length) this.skipLf = true;
      }
      start = i + 1;
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    this.buffer = this.buffer.slice(start);
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === '') {
      const data = this.dataLines;
      const id = this.id;
      this.dataLines = [];
      this.id = undefined;
      return data.length ? { id, data: data.join('\n') } : null;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'id') this.id = value;
    return null;
  }
}

/** Parses one frame payload; returns null for pings and anything malformed. */
export function parseRealtimeEvent(data: string): RealtimeEvent | null {
  try {
    const event = JSON.parse(data) as { type?: unknown };
    if (!event || typeof event.type !== 'string' || event.type === 'ping') return null;
    return event as RealtimeEvent;
  } catch {
    return null;
  }
}

/** Delay before reconnect attempt `attempt` (0-based): 1s doubling up to 30s, with +-20% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Events re-emitted after a reconnect so the UI refetches whatever it missed. */
export const RESYNC_EVENTS: RealtimeEvent[] = [
  { type: 'rooms.changed' },
  { type: 'tasks.changed' },
  { type: 'agents.changed' },
  { type: 'computers.changed' },
  { type: 'connections.changed' },
  { type: 'dashboard.changed' },
];

const resyncListeners = new Set<() => void>();

/** Called after an SSE reconnect, once the connection is healthy again (refetch what was missed). */
export function onRealtimeResync(fn: () => void): () => void {
  resyncListeners.add(fn);
  return () => void resyncListeners.delete(fn);
}

export interface SseClientOptions {
  url: string;
  getToken: () => string | null;
  /** Resolves true when a fresh token is available; false (or throwing) when the session is gone. */
  refresh: () => Promise<boolean>;
  /** Called once when the session is gone (refresh rejected, or a fresh token still gets a 401). */
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
  random?: () => number;
}

/**
 * One shared SSE connection: opened on the first subscriber, aborted when the last leaves.
 * Reconnects with backoff; a 401 triggers a token refresh first.
 */
export class SseRealtimeClient implements RealtimeClient {
  private handlers = new Set<(event: RealtimeEvent) => void>();
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private hasConnected = false;
  private running = false;

  constructor(private readonly opts: SseClientOptions) {}

  subscribe(handler: (event: RealtimeEvent) => void): () => void {
    this.handlers.add(handler);
    if (!this.running) this.start();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) this.stop();
    };
  }

  private start() {
    this.running = true;
    this.attempt = 0;
    this.hasConnected = false;
    void this.connect();
  }

  private stop() {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(event: RealtimeEvent) {
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch {
        /* a failing subscriber must not break the others */
      }
    }
  }

  private scheduleReconnect(minDelayMs = 0) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(backoffDelay(this.attempt++, this.opts.random), minDelayMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  /** `afterRefresh`: this connect follows a token refresh in the same cycle (a second 401 ends the session). */
  private async connect(afterRefresh = false): Promise<void> {
    if (!this.running) return;
    const controller = new AbortController();
    this.abort = controller;
    const doFetch = this.opts.fetchImpl ?? fetch;
    try {
      const token = this.opts.getToken();
      const response = await doFetch(this.opts.url, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!this.running || controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        return;
      }

      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        if (afterRefresh) {
          this.running = false; // fresh token still rejected: the session is gone
          this.opts.onSessionExpired?.();
          return;
        }
        // Another caller already rotated the token: just reconnect with it.
        if (this.opts.getToken() !== token) return void this.connect(false);
        let refreshed = false;
        try {
          refreshed = await this.opts.refresh();
        } catch {
          // refresh endpoint unreachable: treat as a transient failure
          if (this.running && !controller.signal.aborted) return this.scheduleReconnect();
          return;
        }
        if (!this.running || controller.signal.aborted) return;
        if (!refreshed) {
          this.running = false; // session ended: route the app to login
          this.opts.onSessionExpired?.();
          return;
        }
        return void this.connect(true);
      }

      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        return this.scheduleReconnect(retryAfterMs(response));
      }
      if (
        !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')
      ) {
        void response.body.cancel().catch(() => {});
        return this.scheduleReconnect();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let gotBytes = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!gotBytes) {
          // The server sends `: connected` right away; only now is the connection healthy.
          gotBytes = true;
          reportApiReachable(true);
          if (this.hasConnected || this.attempt > 0) {
            for (const event of RESYNC_EVENTS) this.emit(event);
            for (const fn of [...resyncListeners]) {
              try {
                fn();
              } catch {
                /* a failing listener must not break the stream */
              }
            }
          }
          this.hasConnected = true;
          this.attempt = 0;
        }
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          const event = parseRealtimeEvent(frame.data);
          if (event) this.emit(event);
        }
      }
      if (controller.signal.aborted || !this.running) return;
      this.scheduleReconnect();
    } catch {
      if (controller.signal.aborted || !this.running) return;
      this.scheduleReconnect();
    }
  }
}

/** `Retry-After` (seconds) of a 429/503 response, capped at 5 minutes; 0 otherwise. */
function retryAfterMs(response: Response): number {
  if (response.status !== 429 && response.status !== 503) return 0;
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) * 1000 : 0;
}

let sse: SseRealtimeClient | null = null;

export async function connectRealtime(): Promise<RealtimeClient> {
  if (!MOCK) {
    sse ??= new SseRealtimeClient({
      url: `${API_URL}/events`,
      getToken: () => getTokens()?.accessToken ?? null,
      refresh: refreshTokens,
      onSessionExpired: triggerSessionExpired,
    });
    return sse;
  }
  const { mockRealtime } = await import('../mocks/server');
  return mockRealtime;
}
