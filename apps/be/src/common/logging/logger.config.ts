import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { API_PREFIX } from '../../contacts';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A client-supplied id is only echoed when it is short and made of safe characters. */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/** Query keys whose values are masked in the logged url. */
const SENSITIVE_QUERY_KEYS = new Set(
  ['token', 'code', 'key', 'apikey', 'signature', 'secret', 'password'].map((k) => k.toLowerCase()),
);

/** Path plus query, with the values of sensitive keys replaced (`/x?token=[Redacted]&x=1`). */
export const maskUrl = (url: string): string => {
  const [path, query] = url.split('?', 2);
  if (query === undefined) return path;
  const masked = query
    .split('&')
    .map((pair) => {
      const [key] = pair.split('=', 1);
      let name = key;
      try {
        name = decodeURIComponent(key);
      } catch {
        // keep the raw key
      }
      return pair.includes('=') && SENSITIVE_QUERY_KEYS.has(name.toLowerCase())
        ? `${key}=[Redacted]`
        : pair;
    })
    .join('&');
  return `${path}?${masked}`;
};

/**
 * Fields that must never reach a log line, at the top level and nested up to depth 3.
 * Request and response bodies are never logged by design (the serializers below keep only id,
 * method, url and status); redaction is the safety net for anything logged by hand.
 */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'apiKey',
  'refreshToken',
  'accessToken',
  'refresh_token',
  'inviteToken',
  'code',
  'pairingCode',
  'secret',
  'signature',
  'stripe-signature',
];
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => {
    const name = /^[A-Za-z_]\w*$/.test(key) ? key : `["${key}"]`;
    return [name, `*.${name}`, `*.*.${name}`, `*.*.*.${name}`].map((p) => p.replace('.["', '["'));
  }),
];

/** Probes would drown the log; the SSE stream logs once, when it closes. */
const IGNORED_PATH = new RegExp(`^/${API_PREFIX}/v\\d+/health(/|$)`);

export const requestIdFor = (req: IncomingMessage, res: ServerResponse): string => {
  const supplied = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
};

export const buildLoggerParams = (options: { level: string; pretty: boolean }): Params => ({
  pinoHttp: {
    level: options.level,
    genReqId: requestIdFor,
    redact: { paths: REDACTED_PATHS, censor: '[Redacted]' },
    autoLogging: { ignore: (req) => IGNORED_PATH.test((req.url ?? '').split('?')[0]) },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    // Keep request lines small: no headers beyond what redaction leaves, no remote port.
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        // Query values can hold tokens (invite preview, OAuth callbacks): mask the sensitive ones.
        url: maskUrl(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    transport: options.pretty
      ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
  },
});
