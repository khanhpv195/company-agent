import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GatewayClient } from '../src/api.js';
import { Backoff, Daemon } from '../src/daemon.js';
import { silentLogger } from '../src/log.js';
import type { QueryFn } from '../src/runner.js';
import type { GatewayAgent, GatewayAssignment } from '../src/types.js';
import { assignment, envelope, errorResponse, fakeFetch, success, type Call } from './helpers.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-daemon-')));
const agent = (id: string): GatewayAgent => ({
  id,
  name: id,
  persona: '',
  workdir: path.join(root, 'work'),
  maxTurns: 3,
  skills: [],
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(opts: {
  agents: GatewayAgent[];
  queue: GatewayAssignment[];
  hold?: Promise<void>;
  maxChats?: number;
  claimStatus?: number;
}) {
  const queue = [...opts.queue];
  const { fetchImpl, calls } = fakeFetch({
    '/gateway/heartbeat': () => envelope({ agents: opts.agents }),
    '/gateway/claim': () =>
      opts.claimStatus
        ? errorResponse(opts.claimStatus, 'bad key')
        : envelope(queue.shift() ?? null),
    '/accept': () => envelope({ ok: true }),
    '/progress': () => envelope({ ok: true, cancelled: false }),
    '/result': () => envelope({ ok: true }),
    '/heartbeat': () => envelope({ ok: true, cancelled: false }),
  });
  const query: QueryFn = async function* ({ options }) {
    const signal = options!.abortController!.signal;
    // like the real SDK, the stream ends when the abort controller fires
    await Promise.race([
      opts.hold,
      new Promise<void>((r) => signal.addEventListener('abort', () => r())),
    ]);
    if (signal.aborted) return;
    yield success('done');
  };
  const onFatal = vi.fn();
  const daemon = new Daemon({
    client: new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl }),
    config: { extraAllowedTools: [], allowWebFetch: false, workdirRoots: [root] },
    query,
    log: silentLogger,
    cliVersion: '0.1.0',
    maxChats: opts.maxChats ?? 3,
    timing: { flushMs: 5, leaseMs: 1000 },
    onFatal,
  });
  return { daemon, calls, onFatal };
}

const chat = (n: number, agentId = 'a1') =>
  assignment({ id: `chat-${n}`, kind: 'chat', agent: agent(agentId) });
const task = (n: number, agentId: string) =>
  assignment({ id: `task-${n}`, kind: 'task', agent: agent(agentId) });
const claims = (calls: Call[]) => calls.filter((c) => c.path === '/gateway/claim');

describe('Daemon', () => {
  it('heartbeat caches agents', async () => {
    const t = setup({ agents: [agent('a1')], queue: [] });
    await t.daemon.heartbeatOnce();
    expect(t.daemon.agents.map((a) => a.id)).toEqual(['a1']);
  });

  it('caps concurrent chats at maxChats and sends remaining slots', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const t = setup({
      agents: [],
      queue: [chat(1), chat(2), chat(3), chat(4)],
      hold,
    });
    await t.daemon.heartbeatOnce();
    expect(await t.daemon.claimOnce()).toBe(3);
    expect(t.daemon.runningChats()).toBe(3);
    expect(claims(t.calls).map((c) => c.body.maxChats)).toEqual([3, 2, 1]);
    // full: no further claim attempts (no agents = no task slots)
    expect(await t.daemon.claimOnce()).toBe(0);
    expect(claims(t.calls)).toHaveLength(3);
    release();
    await t.daemon.shutdown();
  });

  it('allows one task run per agent and keeps claiming for tasks when chats are full', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const t = setup({
      agents: [agent('a1'), agent('a2')],
      queue: [task(1, 'a1'), task(2, 'a2')],
      hold,
      maxChats: 1,
    });
    await t.daemon.heartbeatOnce();
    expect(await t.daemon.claimOnce()).toBe(2); // two agents -> two task slots
    expect(t.daemon.capacity()).toEqual({ chatSlots: 1, taskSlots: 0 });
    // chat slot still open, so one more claim is made (queue empty -> null)
    expect(claims(t.calls).length).toBe(3);
    release();
    await t.daemon.shutdown();
  });

  it('frees capacity when a run finishes', async () => {
    const t = setup({ agents: [], queue: [chat(1)], maxChats: 1 });
    await t.daemon.claimOnce();
    await sleep(80);
    expect(t.daemon.active.size).toBe(0);
    expect(t.calls.some((c) => c.path.endsWith('/result'))).toBe(true);
  });

  it('shutdown aborts running assignments and reports daemon stopped', async () => {
    const t = setup({ agents: [], queue: [chat(1), chat(2)], hold: new Promise(() => {}) });
    await t.daemon.claimOnce();
    await sleep(20);
    await t.daemon.shutdown(2000);
    const results = t.calls.filter((c) => c.path.endsWith('/result'));
    expect(results).toHaveLength(2);
    expect(
      results.every((r) => r.body.status === 'failed' && r.body.error === 'daemon stopped'),
    ).toBe(true);
    expect(await t.daemon.claimOnce()).toBe(0);
  });

  it('treats a rejected API key as fatal', async () => {
    const t = setup({ agents: [], queue: [], claimStatus: 401 });
    await t.daemon.claimOnce();
    expect(t.onFatal).toHaveBeenCalledOnce();
  });
});

describe('Daemon resilience', () => {
  it('a claim that lands after shutdown began is reported failed, not run', async () => {
    let releaseClaim!: () => void;
    const gate = new Promise<void>((r) => (releaseClaim = r));
    let ran = false;
    const queue = [chat(1)];
    const { fetchImpl, calls } = fakeFetch({
      '/gateway/heartbeat': () => envelope({ agents: [] }),
      '/gateway/claim': async () => {
        await gate;
        return envelope(queue.shift() ?? null);
      },
      '/accept': () => envelope({ ok: true }),
      '/progress': () => envelope({ ok: true, cancelled: false }),
      '/result': () => envelope({ ok: true }),
      '/heartbeat': () => envelope({ ok: true, cancelled: false }),
    });
    const query: QueryFn = async function* () {
      ran = true;
      yield success('x');
    };
    const daemon = new Daemon({
      client: new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl }),
      config: { extraAllowedTools: [], allowWebFetch: false, workdirRoots: [root] },
      query,
      log: silentLogger,
      cliVersion: '0.1.0',
      maxChats: 3,
    });
    const claiming = daemon.claimOnce();
    await sleep(10);
    const stopped = daemon.shutdown(2000);
    releaseClaim();
    await claiming;
    await stopped;
    expect(ran).toBe(false);
    const result = calls.find((c) => c.path.endsWith('/result'));
    expect(result?.body).toMatchObject({ status: 'failed', error: 'daemon stopped' });
    expect(daemon.active.size).toBe(0);
  });

  it('backs off with a cap while the server is down and resets on success', () => {
    const b = new Backoff(1000, 5000);
    expect(b.ready(0)).toBe(true);
    expect([b.fail(0), b.fail(0), b.fail(0), b.fail(0)]).toEqual([1000, 2000, 4000, 5000]);
    expect(b.ready(4999)).toBe(false);
    expect(b.ready(5000)).toBe(true);
    expect(b.ok()).toBe(4);
    expect(b.ready(0)).toBe(true);
    expect(b.fail(0)).toBe(1000);
  });

  it('does not overlap heartbeats', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetchImpl } = fakeFetch({
      '/gateway/heartbeat': async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(30);
        inFlight -= 1;
        return envelope({ agents: [] });
      },
    });
    const daemon = new Daemon({
      client: new GatewayClient({ server: 'http://x', apiKey: 'k', fetchImpl }),
      config: { extraAllowedTools: [], allowWebFetch: false, workdirRoots: [root] },
      query: async function* () {},
      log: silentLogger,
      cliVersion: '0.1.0',
      maxChats: 1,
    });
    await Promise.all([daemon.heartbeatOnce(), daemon.heartbeatOnce(), daemon.heartbeatOnce()]);
    expect(maxInFlight).toBe(1);
  });
});
