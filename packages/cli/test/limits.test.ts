import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GatewayClient } from '../src/api.js';
import { Daemon } from '../src/daemon.js';
import { silentLogger } from '../src/log.js';
import { buildPermissionRules } from '../src/permissions.js';
import { runAssignment, splitBatches, trimBytes, type QueryFn } from '../src/runner.js';
import type { GatewayEvent } from '../src/types.js';
import { assignment, envelope, errorResponse, fakeFetch, success } from './helpers.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-limits-')));
const config = { extraAllowedTools: [], allowWebFetch: false, workdirRoots: [root] };

describe('trimBytes / splitBatches', () => {
  it('trims by UTF-8 bytes and marks the cut', () => {
    const out = trimBytes('é'.repeat(1000), 100);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(100);
    expect(out.endsWith('…(đã cắt)')).toBe(true);
    expect(trimBytes('short', 100)).toBe('short');
  });

  it('keeps every batch under the limit and loses no text', () => {
    const big = 'ế'.repeat(5000);
    const events: GatewayEvent[] = [
      { kind: 'text', delta: big },
      { kind: 'turns', turns: 1 },
    ];
    const batches = splitBatches(events, 4000);
    for (const b of batches)
      expect(Buffer.byteLength(JSON.stringify({ events: b }))).toBeLessThan(4000);
    const text = batches
      .flat()
      .map((e) => (e.kind === 'text' ? e.delta : ''))
      .join('');
    expect(text).toBe(big);
  });
});

describe('result size', () => {
  const run = async (resultStatus: number | null, text: string) => {
    const bodies: number[] = [];
    const { fetchImpl, calls } = fakeFetch({
      '/accept': () => envelope({ ok: true }),
      '/heartbeat': () => envelope({ ok: true, cancelled: false }),
      '/progress': () => envelope({ ok: true, cancelled: false }),
      '/result': (c) => {
        bodies.push(Buffer.byteLength(String(c.body.text ?? '')));
        return resultStatus && bodies.length === 1
          ? errorResponse(resultStatus, 'too big')
          : envelope({ ok: true });
      },
    });
    const query: QueryFn = async function* () {
      yield success(text);
    };
    const client = new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl });
    const a = assignment({ agent: { ...assignment().agent, workdir: path.join(root, 'w') } });
    await runAssignment(
      a,
      {
        client,
        config,
        query,
        log: silentLogger,
        timing: { flushMs: 10, leaseMs: 10, retryBaseMs: 5 },
      },
      new AbortController(),
    );
    return { bodies, calls };
  };

  it('trims huge results to 900 KB', async () => {
    const { bodies } = await run(null, 'x'.repeat(2_000_000));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toBeLessThanOrEqual(900 * 1024);
  });

  it('retries once with 50 KB on 413', async () => {
    const { bodies } = await run(413, 'x'.repeat(200_000));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBeLessThanOrEqual(50 * 1024);
  });
});

describe('workdir guards', () => {
  it('denies Edit/Write on .git, .claude and friends inside the workdir', () => {
    const r = buildPermissionRules('/w/hana', { ...config, home: '/h', env: {} });
    for (const t of ['Edit', 'Write']) {
      for (const p of [
        '.git/**',
        '.claude/**',
        '.envrc',
        '.vscode/**',
        '.idea/**',
        '.husky/**',
        '.mcp.json',
        '**/.git/**',
        '**/.claude/**',
        '**/.husky/**',
        '**/.vscode/**',
        '**/.idea/**',
        '**/.envrc',
        '**/.mcp.json',
      ]) {
        expect(r.disallowedTools).toContain(`${t}(//w/hana/${p})`);
      }
    }
  });
});

describe('cancel via computer heartbeat', () => {
  it('aborts a running assignment listed in `cancelled`', async () => {
    const { fetchImpl } = fakeFetch({
      '/gateway/heartbeat': () => envelope({ agents: [], cancelled: ['as-1'] }),
      '/gateway/claim': () => envelope(null),
      '/accept': () => envelope({ ok: true }),
      '/progress': () => envelope({ ok: true, cancelled: false }),
      '/result': () => envelope({ ok: true }),
      '/heartbeat': () => envelope({ ok: true, cancelled: false }),
    });
    const query: QueryFn = async function* ({ options }) {
      const s = options!.abortController!.signal;
      if (!s.aborted) await new Promise<void>((r) => s.addEventListener('abort', () => r()));
      yield* [];
    };
    const daemon = new Daemon({
      client: new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl }),
      config,
      query,
      log: silentLogger,
      cliVersion: '0',
      maxChats: 1,
      timing: { flushMs: 5, leaseMs: 1000 },
    });
    const abort = new AbortController();
    const done = runAssignment(
      assignment({ agent: { ...assignment().agent, workdir: path.join(root, 'w2') } }),
      (daemon as unknown as { opts: ConstructorParameters<typeof Daemon>[0] }).opts,
      abort,
    );
    (daemon.active as Map<string, unknown>).set('as-1', {
      assignment: assignment(),
      abort,
      done,
    });
    await daemon.heartbeatOnce();
    await done;
    expect(abort.signal.aborted).toBe(true);
  });
});
