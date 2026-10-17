import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '@repo/shared';
import {
  RESYNC_EVENTS,
  SseParser,
  SseRealtimeClient,
  backoffDelay,
  parseRealtimeEvent,
} from './realtime';

describe('SseParser', () => {
  it('parses a frame with id and data', () => {
    const p = new SseParser();
    expect(p.push('id: 4\ndata: {"type":"tasks.changed"}\n\n')).toEqual([
      { id: '4', data: '{"type":"tasks.changed"}' },
    ]);
  });

  it('handles chunks split mid-line and mid-boundary', () => {
    const p = new SseParser();
    expect(p.push('id: 1\nda')).toEqual([]);
    expect(p.push('ta: {"type":"rooms.')).toEqual([]);
    expect(p.push('changed"}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ id: '1', data: '{"type":"rooms.changed"}' }]);
  });

  it('joins multiple data lines with newline', () => {
    const p = new SseParser();
    expect(p.push('data: a\ndata: b\n\n')).toEqual([{ id: undefined, data: 'a\nb' }]);
  });

  it('ignores comments and returns several frames from one chunk', () => {
    const p = new SseParser();
    const frames = p.push(': ping\n\ndata: 1\n\n: ping\ndata: 2\n\n');
    expect(frames.map((f) => f.data)).toEqual(['1', '2']);
  });

  it('supports CRLF, including a CR/LF split across chunks', () => {
    const p = new SseParser();
    expect(p.push('data: x\r')).toEqual([]);
    expect(p.push('\n\r\n')).toEqual([{ id: undefined, data: 'x' }]);
  });
});

describe('parseRealtimeEvent', () => {
  it('parses events and ignores ping / malformed data', () => {
    expect(parseRealtimeEvent('{"type":"tasks.changed"}')).toEqual({ type: 'tasks.changed' });
    expect(parseRealtimeEvent('{"type":"ping"}')).toBeNull();
    expect(parseRealtimeEvent('not json')).toBeNull();
    expect(parseRealtimeEvent('{"foo":1}')).toBeNull();
  });
});

describe('backoffDelay', () => {
  it('grows from 1s to a 30s cap', () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, mid)).toBe(1000);
    expect(backoffDelay(1, mid)).toBe(2000);
    expect(backoffDelay(4, mid)).toBe(16000);
    expect(backoffDelay(10, mid)).toBe(30000);
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
  });
});

const encoder = new TextEncoder();

/** A controllable SSE response. */
function sseResponse(signal?: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener('abort', () => {
        try {
          c.error(new DOMException('aborted', 'AbortError'));
        } catch {
          /* already closed */
        }
      });
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('SseRealtimeClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (fetchImpl: typeof fetch, refresh = vi.fn(async () => true)) => {
    let token = 'tok1';
    const onSessionExpired = vi.fn();
    const client = new SseRealtimeClient({
      url: 'http://api/events',
      getToken: () => token,
      refresh: async () => {
        const ok = await refresh();
        token = 'tok2';
        return ok;
      },
      onSessionExpired,
      fetchImpl,
      random: () => 0.5,
    });
    return { client, refresh, onSessionExpired };
  };

  it('shares one connection, sends the bearer token and fans out events', async () => {
    const streams: ReturnType<typeof sseResponse>[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const s = sseResponse(init?.signal ?? undefined);
      streams.push(s);
      return s.response;
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const a: RealtimeEvent[] = [];
    const b: RealtimeEvent[] = [];
    const offA = client.subscribe((e) => a.push(e));
    const offB = client.subscribe((e) => b.push(e));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok1' });

    streams[0]!.send(
      ': ping\n\nid: 1\ndata: {"type":"tasks.changed"}\n\ndata: {"type":"ping"}\n\n',
    );
    await flush();
    expect(a).toEqual([{ type: 'tasks.changed' }]);
    expect(b).toEqual([{ type: 'tasks.changed' }]);
    offA();
    offB();
  });

  it('aborts the fetch when the last subscriber leaves', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return sseResponse(signal).response;
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const off1 = client.subscribe(() => {});
    const off2 = client.subscribe(() => {});
    await flush();
    off1();
    expect(signal?.aborted).toBe(false);
    off2();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff and emits resync events only after a reconnect', async () => {
    const streams: ReturnType<typeof sseResponse>[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      call++;
      if (call === 2) throw new TypeError('network down');
      const s = sseResponse(init?.signal ?? undefined);
      streams.push(s);
      return s.response;
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const seen: RealtimeEvent[] = [];
    const off = client.subscribe((e) => seen.push(e));
    await flush();
    streams[0]!.send(': connected\n\n');
    await flush();
    expect(seen).toEqual([]); // first connect: no resync

    streams[0]!.close(); // server drops the stream
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // attempt 0 -> 1s, fails (call 2)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // next delay is 2s
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    streams[1]!.send(': connected\n\n');
    await flush();
    expect(seen).toEqual(RESYNC_EVENTS);
    off();
  });

  it('on 401 refreshes once and reconnects with the new token', async () => {
    const tokens: string[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      tokens.push((init?.headers as Record<string, string>).Authorization!);
      call++;
      if (call === 1) return new Response('{}', { status: 401 });
      return sseResponse(init?.signal ?? undefined).response;
    }) as unknown as typeof fetch;
    const { client, refresh } = make(fetchImpl);
    const seen: RealtimeEvent[] = [];
    const off = client.subscribe((e) => seen.push(e));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(['Bearer tok1', 'Bearer tok2']);
    expect(seen).toEqual([]); // initial connection, no resync
    off();
  });

  it('stops reconnecting when the refresh is rejected', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 401 }),
    ) as unknown as typeof fetch;
    const { client, onSessionExpired } = make(
      fetchImpl,
      vi.fn(async () => false),
    );
    const off = client.subscribe(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    off();
  });
  const sseOk = (init?: RequestInit) => sseResponse(init?.signal ?? undefined);

  it('treats a 200 without text/event-stream as a failure and backs off', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const off = client.subscribe(() => {});
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 2s, not a storm
    off();
  });

  it('keeps backing off when streams open and close without any bytes', async () => {
    const streams: ReturnType<typeof sseResponse>[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const s = sseOk(init);
      streams.push(s);
      s.close();
      return s.response;
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const off = client.subscribe(() => {});
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // attempt was not reset: 2s
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    off();
  });

  it('stops when a 401 persists right after a successful refresh', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 401 }),
    ) as unknown as typeof fetch;
    const { client, refresh, onSessionExpired } = make(fetchImpl);
    const off = client.subscribe(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    off();
  });

  it('skips the refresh when the stored token already changed', async () => {
    let token = 'old';
    const refresh = vi.fn(async () => true);
    let call = 0;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      call++;
      if (call === 1) {
        token = 'new'; // rotated by someone else while the request was in flight
        return new Response('{}', { status: 401 });
      }
      return sseOk(init).response;
    }) as unknown as typeof fetch;
    const client = new SseRealtimeClient({
      url: 'http://api/events',
      getToken: () => token,
      refresh,
      fetchImpl,
      random: () => 0.5,
    });
    const off = client.subscribe(() => {});
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      ((vi.mocked(fetchImpl).mock.calls[1]![1] as RequestInit).headers as Record<string, string>)
        .Authorization,
    ).toBe('Bearer new');
    off();
  });

  it('clears the reconnect timer when unsubscribing during backoff', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('down');
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const off = client.subscribe(() => {});
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After on 429 and 503 as the minimum delay', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('busy', { status: 503, headers: { 'retry-after': '10' } }),
    ) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const off = client.subscribe(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    off();
  });

  it('resyncs on the first successful open that followed failed attempts', async () => {
    const streams: ReturnType<typeof sseResponse>[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      call++;
      if (call === 1) throw new TypeError('down');
      const s = sseOk(init);
      streams.push(s);
      return s.response;
    }) as unknown as typeof fetch;
    const { client } = make(fetchImpl);
    const seen: RealtimeEvent[] = [];
    const off = client.subscribe((e) => seen.push(e));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]); // not healthy until bytes arrive
    streams[0]!.send(': connected\n\n');
    await flush();
    expect(seen).toEqual(RESYNC_EVENTS);
    off();
  });
});
