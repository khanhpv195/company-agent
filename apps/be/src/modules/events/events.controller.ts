import { Controller, Get, Inject, Logger, Req, Res } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentAuth, RawResponse } from '../../common/decorators';
import type { AuthContext } from '../../common/types';
import { appConfig, type AppConfig } from '../../config';
import { EventsService, REALTIME_EVENT, type RealtimeEnvelope } from './events.service';

/** Drop a client whose socket buffer grows past this (slow or stalled reader). */
const MAX_WRITABLE_BYTES = 1024 * 1024;
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Server-Sent Events stream of the caller's workspace events.
 *
 * Streaming choice: the handler writes to the raw response (`@Res()`) instead of using
 * Nest's `@Sse()`, because `@Sse()` cannot emit `: ping` comment lines and we want full
 * control of the headers. The global `JwtAuthGuard` still runs first (a missing token
 * returns the normal 401 JSON envelope) and `@RawResponse()` keeps the response envelope
 * away from the stream; with `@Res()` Nest does not write the handler's return value.
 *
 * Event ids are per connection (a counter starting at 1) and are NOT replayable: there is
 * no Last-Event-ID support, a reconnecting client resyncs by refetching instead.
 *
 * Privacy: events carrying `memberIds` (private DMs) are delivered only to the listed members
 * (fail-closed). The access token is verified only when the stream opens, so the server ends
 * the stream when that token expires (a timer at its `exp`); the client then refreshes its
 * token and reconnects, which keeps the identity (and any membership checks) fresh.
 *
 * Fan-out is in-process via EventEmitter2. A multi-instance deployment needs Postgres
 * LISTEN/NOTIFY (or similar) to relay events between API instances.
 */
@ApiTags('events')
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly events: EventsService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  @Get()
  @RawResponse()
  @ApiOperation({ summary: 'Realtime event stream (SSE) for the current workspace' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'Frames `id: <n>` + `data: <RealtimeEvent JSON>`; `: ping` comments as heartbeat.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  stream(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res() res: Response): void {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (expiry) clearTimeout(expiry);
      this.emitter.off(REALTIME_EVENT, listener);
      unregister();
    };
    const drop = (): void => {
      cleanup();
      res.destroy();
    };
    /** Writes one chunk; drops the client when it is gone or not keeping up. */
    const send = (chunk: string): void => {
      if (closed) return;
      if (res.destroyed || res.writableLength > MAX_WRITABLE_BYTES) return drop();
      res.write(chunk);
    };

    let lastId = 0;
    const listener = (envelope: RealtimeEnvelope): void => {
      try {
        if (envelope.workspaceId !== auth.workspaceId) return;
        if (envelope.memberIds && !envelope.memberIds.includes(auth.memberId)) return;
        lastId += 1;
        send(`id: ${lastId}\ndata: ${JSON.stringify(envelope.event)}\n\n`);
      } catch (error) {
        this.logger.warn(`SSE write failed: ${String(error)}`);
        drop(); // never let one broken stream throw into EventsService.publish
      }
    };
    const heartbeat = setInterval(() => {
      try {
        send(': ping\n\n');
      } catch {
        drop();
      }
    }, this.config.sseHeartbeatMs);

    const end = (): void => {
      cleanup();
      res.end();
    };
    const unregister = this.events.registerStream(end);
    // End the stream when its access token runs out (setTimeout caps at 2^31-1 ms).
    const expiry =
      auth.exp === undefined
        ? undefined
        : setTimeout(end, Math.min(Math.max(auth.exp * 1000 - Date.now(), 0), MAX_TIMER_MS));
    expiry?.unref();
    this.emitter.on(REALTIME_EVENT, listener);
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }
}
