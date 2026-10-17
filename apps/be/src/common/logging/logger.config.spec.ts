import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';
import { maskUrl, REDACTED_PATHS, requestIdFor } from './logger.config';

const lines = (): { log: (data: object) => void; out: () => Record<string, unknown> } => {
  const chunks: string[] = [];
  const logger = pino(
    { redact: { paths: REDACTED_PATHS, censor: '[Redacted]' } },
    { write: (chunk: string) => void chunks.push(chunk) },
  );
  return {
    log: (data) => logger.info(data),
    out: () => JSON.parse(chunks[0]) as Record<string, unknown>,
  };
};

describe('log redaction', () => {
  it('hides credentials at the top level and one level down', () => {
    const sink = lines();
    sink.log({
      password: 'hunter2',
      body: { newPassword: 'a', currentPassword: 'b', token: 't', apiKey: 'k' },
      req: { headers: { authorization: 'Bearer secret', cookie: 'sid=1', host: 'x' } },
      refreshToken: 'r',
      keep: 'visible',
    });
    const out = sink.out();
    expect(JSON.stringify(out)).not.toMatch(/hunter2|Bearer secret|sid=1|"t"|"k"/);
    expect(out.keep).toBe('visible');
    expect((out.req as { headers: { host: string } }).headers.host).toBe('x');
  });
});

describe('log redaction (extended)', () => {
  it('hides codes, secrets and signatures up to depth 3 and the set-cookie header', () => {
    const sink = lines();
    sink.log({
      a: { b: { c: { pairingCode: 'PAIR1' } } },
      body: { inviteToken: 'INV1', refresh_token: 'RT1', secret: 'SEC1', code: 'CODE1' },
      headers: { 'stripe-signature': 'SIG1' },
      deep: { x: { signature: 'SIG2' } },
      res: { headers: { 'set-cookie': ['sid=COOKIE1'] } },
      keep: 'visible',
    });
    const text = JSON.stringify(sink.out());
    expect(text).not.toMatch(/PAIR1|INV1|RT1|SEC1|CODE1|SIG1|SIG2|COOKIE1/);
    expect(text).toContain('visible');
  });
});

describe('maskUrl', () => {
  it('keeps the path and masks only sensitive query values', () => {
    expect(maskUrl('/invites/preview?token=abc&x=1')).toBe('/invites/preview?token=[Redacted]&x=1');
    expect(maskUrl('/a?apiKey=k&Code=c&y=2')).toBe('/a?apiKey=[Redacted]&Code=[Redacted]&y=2');
    expect(maskUrl('/plain')).toBe('/plain');
  });
});

describe('requestIdFor', () => {
  const call = (header?: string) => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => (headers[k] = v),
    } as unknown as ServerResponse;
    const req = { headers: header ? { 'x-request-id': header } : {} } as unknown as IncomingMessage;
    return { id: requestIdFor(req, res), headers };
  };

  it('keeps a safe client id and echoes it', () => {
    const { id, headers } = call('abc-123');
    expect(id).toBe('abc-123');
    expect(headers['x-request-id']).toBe('abc-123');
  });

  it('replaces missing, oversized or unsafe ids with a uuid', () => {
    for (const bad of [undefined, 'x'.repeat(200), 'has space', 'a\nb']) {
      const { id, headers } = call(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers['x-request-id']).toBe(id);
    }
  });
});
