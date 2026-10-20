import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GatewayClient } from '../src/api.js';
import { silentLogger } from '../src/log.js';
import { ABORT_CANCELLED, ABORT_SHUTDOWN, runAssignment, type QueryFn } from '../src/runner.js';
import {
  assignment,
  envelope,
  errorResponse,
  fakeFetch,
  sdkMsg,
  success,
  textDelta,
  toolResult,
  toolUse,
} from './helpers.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-root-')));
const config = {
  extraAllowedTools: ['Bash(git status *)'],
  allowWebFetch: false,
  workdirRoots: [root],
};
const timing = { flushMs: 10, leaseMs: 10, retryBaseMs: 5 };

function setup(
  handlers: Parameters<typeof fakeFetch>[0],
  gen: (opts: Options) => AsyncGenerator<SDKMessage>,
) {
  const { fetchImpl, calls } = fakeFetch({
    '/accept': () => envelope({ ok: true }),
    '/heartbeat': () => envelope({ ok: true, cancelled: false }),
    '/progress': () => envelope({ ok: true, cancelled: false }),
    '/result': () => envelope({ ok: true }),
    ...handlers,
  });
  let seen: { prompt: string; options: Options } | undefined;
  const query: QueryFn = ({ prompt, options }) => {
    seen = { prompt, options: options! };
    return gen(options!);
  };
  const client = new GatewayClient({ server: 'http://x', apiKey: 'agk', fetchImpl });
  return {
    calls,
    seen: () => seen!,
    run: (a: ReturnType<typeof assignment>, abort = new AbortController()) =>
      runAssignment(a, { client, config, query, log: silentLogger, timing }, abort),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let n = 0;
async function withWorkdir() {
  return path.join(root, `wd-${++n}`, 'nested');
}

describe('runAssignment skills', () => {
  const agentHomeDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-home-')));
  const withHome = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = process.env.AGENT_HOME;
    process.env.AGENT_HOME = agentHomeDir;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.AGENT_HOME;
      else process.env.AGENT_HOME = prev;
    }
  };
  const skill = {
    slug: 'tom-tat',
    name: 'Tóm tắt',
    description: 'Summarise',
    content: 'body',
    version: 1,
  };

  it('passes the plugin and skills to query and installs the files', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      yield success('ok');
    });
    await withHome(() =>
      t.run(assignment({ agent: { ...assignment().agent, workdir, skillDefs: [skill] } })),
    );
    const o = t.seen().options;
    const dir = path.join(agentHomeDir, 'skills', 'ag-1');
    expect(o.plugins).toEqual([{ type: 'local', path: dir, skipMcpDiscovery: true }]);
    expect(o.skills).toEqual(['workspace:tom-tat']);
    expect(o.settingSources).toEqual([]);
    expect(readFileSync(path.join(dir, 'skills', 'tom-tat', 'SKILL.md'), 'utf8')).toContain(
      'name: tom-tat',
    );
  });

  it('passes neither option when skillDefs is missing or empty', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      yield success('ok');
    });
    await withHome(() => t.run(assignment({ agent: { ...assignment().agent, workdir } })));
    expect(t.seen().options).not.toHaveProperty('plugins');
    expect(t.seen().options).not.toHaveProperty('skills');
  });

  it('fails the run without calling the SDK when a slug is unsafe', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      yield success('ok');
    });
    await withHome(() =>
      t.run(
        assignment({
          agent: { ...assignment().agent, workdir, skillDefs: [{ ...skill, slug: '../x' }] },
        }),
      ),
    );
    expect(t.seen()).toBeUndefined();
    const last = t.calls[t.calls.length - 1];
    expect(last.path).toBe('/gateway/assignments/as-1/result');
    expect(last.body.status).toBe('failed');
    expect(String(last.body.error)).toMatch(/invalid slug/);
  });
});

describe('runAssignment', () => {
  it('chat: accepts, streams text and tools, reports completed with session/turns/cost', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      yield textDelta('Hello');
      yield toolUse('t1', 'mcp__workspace__list_tasks', {});
      yield toolResult('t1', 'ok');
      yield success('Hello world');
    });
    await t.run(assignment({ agent: { ...assignment().agent, workdir } }));

    const paths = t.calls.map((c) => c.path);
    expect(paths[0]).toBe('/gateway/assignments/as-1/accept');
    const events = t.calls
      .filter((c) => c.path.endsWith('/progress'))
      .flatMap((c) => c.body.events as { kind: string }[]);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['text', 'tool', 'turns']));
    const last = t.calls[t.calls.length - 1];
    expect(last.path).toBe('/gateway/assignments/as-1/result');
    expect(last.body).toEqual({
      attempt: 1,
      status: 'completed',
      text: 'Hello world',
      sessionId: 'sess-1',
      numTurns: 2,
      costUsd: 0.0123,
    });
  });

  it('passes the right SDK options (new session, then resume)', async () => {
    const workdir = await withWorkdir();
    const base = assignment({ agent: { ...assignment().agent, workdir } });

    const a = setup({}, async function* () {
      yield success('x');
    });
    await a.run(base);
    const o = a.seen().options;
    expect(a.seen().prompt).toBe('hello');
    expect(o).toMatchObject({
      cwd: workdir,
      sessionId: base.session.id,
      maxTurns: 5,
      permissionMode: 'dontAsk',
      settingSources: [],
      includePartialMessages: true,
    });
    expect(o.resume).toBeUndefined();
    expect(o.allowedTools).toEqual([
      `Read(//${workdir.slice(1)}/**)`,
      `Edit(//${workdir.slice(1)}/**)`,
      `Write(//${workdir.slice(1)}/**)`,
      'mcp__workspace__*',
      'Bash(git status *)',
    ]);
    // no bare file tools (they would not be confined to the workdir)
    for (const bare of ['Read', 'Edit', 'Write', 'Grep', 'Glob']) {
      expect(o.allowedTools).not.toContain(bare);
    }
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['WebFetch']));
    const sp = o.systemPrompt as { type: string; preset: string; append: string };
    expect(sp).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(sp.append).toContain('Hana');
    expect(sp.append).toContain('Be brief.');
    expect(sp.append).toContain('Khanh (admin)');
    expect(Object.keys(o.mcpServers!)).toEqual(['workspace']);

    const b = setup({}, async function* () {
      yield success('x');
    });
    await b.run({ ...base, session: { ...base.session, resume: true } });
    expect(b.seen().options.resume).toBe(base.session.id);
    expect(b.seen().options.sessionId).toBeUndefined();
  });

  it('task runs do not stream text but report the result text', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      yield textDelta('draft');
      yield success('summary');
    });
    await t.run(assignment({ kind: 'task', agent: { ...assignment().agent, workdir } }));
    const texts = t.calls
      .filter((c) => c.path.endsWith('/progress'))
      .flatMap((c) => c.body.events as { kind: string }[])
      .filter((e) => e.kind === 'text');
    expect(texts).toEqual([]);
    expect(t.calls.at(-1)!.body).toMatchObject({ status: 'completed', text: 'summary' });
  });

  it('reports failed when the SDK throws or ends without a result', async () => {
    const workdir = await withWorkdir();
    const a = assignment({ agent: { ...assignment().agent, workdir } });
    const boom = setup({}, async function* () {
      yield textDelta('x');
      throw new Error('claude crashed');
    });
    await boom.run(a);
    expect(boom.calls.at(-1)!.body).toMatchObject({ status: 'failed', error: 'claude crashed' });

    const empty = setup({}, async function* () {});
    await empty.run(a);
    expect(empty.calls.at(-1)!.body).toMatchObject({
      status: 'failed',
      error: 'agent ended without a result',
    });
  });

  it('skips the run when accept is rejected', async () => {
    const t = setup({ '/accept': () => errorResponse(409, 'gone') }, async function* () {
      yield success('never');
    });
    await t.run(assignment());
    expect(t.calls.map((c) => c.path)).toEqual(['/gateway/assignments/as-1/accept']);
  });

  it('cancellation via heartbeat aborts and reports nothing', async () => {
    const workdir = await withWorkdir();
    let aborted = false;
    const t = setup(
      { '/heartbeat': () => envelope({ ok: true, cancelled: true }) },
      async function* (opts) {
        opts.abortController!.signal.addEventListener('abort', () => (aborted = true));
        yield textDelta('working');
        await sleep(200);
        yield success('too late');
      },
    );
    const abort = new AbortController();
    await t.run(assignment({ agent: { ...assignment().agent, workdir } }), abort);
    expect(aborted).toBe(true);
    expect(abort.signal.reason).toBe(ABORT_CANCELLED);
    expect(t.calls.some((c) => c.path.endsWith('/result'))).toBe(false);
  });

  it('cancellation via progress response aborts', async () => {
    const workdir = await withWorkdir();
    const t = setup(
      { '/progress': () => envelope({ ok: true, cancelled: true }) },
      async function* () {
        yield textDelta('a');
        await sleep(100);
        yield textDelta('b');
        await sleep(100);
        yield success('late');
      },
    );
    const abort = new AbortController();
    await t.run(assignment({ agent: { ...assignment().agent, workdir } }), abort);
    expect(abort.signal.reason).toBe(ABORT_CANCELLED);
    expect(t.calls.some((c) => c.path.endsWith('/result'))).toBe(false);
  });

  it('shutdown abort reports failed "daemon stopped"', async () => {
    const workdir = await withWorkdir();
    const abort = new AbortController();
    const t = setup({}, async function* () {
      yield textDelta('x');
      abort.abort(ABORT_SHUTDOWN);
      await sleep(20);
      yield success('ignored');
    });
    await t.run(assignment({ agent: { ...assignment().agent, workdir } }), abort);
    expect(t.calls.at(-1)).toMatchObject({
      path: '/gateway/assignments/as-1/result',
      body: { status: 'failed', error: 'daemon stopped' },
    });
  });

  it('sends lease heartbeats while running', async () => {
    const workdir = await withWorkdir();
    const t = setup({}, async function* () {
      await sleep(60);
      yield success('x');
    });
    await t.run(assignment({ agent: { ...assignment().agent, workdir } }));
    expect(t.calls.filter((c) => c.path.endsWith('/heartbeat')).length).toBeGreaterThanOrEqual(2);
  });

  it('fails the run (reported as failed) when the workdir is outside the allowed roots', async () => {
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-out-')));
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await symlink(outside, path.join(root, 'escape'));
    const cases = [
      '/',
      '~',
      '~/../..',
      '../..',
      '',
      '   ',
      root, // the root itself is not a valid workdir
      outside,
      path.join(root, '..', 'sibling'),
      path.join(root, 'escape'), // symlink to outside
      path.join(root, 'escape', 'child'),
    ];
    for (const workdir of cases) {
      let queried = false;
      const t = setup({}, async function* () {
        queried = true;
        yield success('x');
      });
      await t.run(assignment({ agent: { ...assignment().agent, workdir } }));
      const last = t.calls.at(-1)!;
      expect(last.path, `workdir ${JSON.stringify(workdir)}`).toBe(
        '/gateway/assignments/as-1/result',
      );
      expect(last.body).toMatchObject({ status: 'failed' });
      expect(String(last.body.error)).toMatch(/workdir (is empty|outside allowed roots)/);
      expect(queried).toBe(false);
    }
    // nothing was created through the symlink
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(outside)).toEqual([]);
  });

  it('retries a resume whose session is missing with a fresh session id', async () => {
    const workdir = await withWorkdir();
    const base = assignment({
      agent: { ...assignment().agent, workdir },
      session: { id: '22222222-2222-4222-8222-222222222222', resume: true },
    });
    const seen: Options[] = [];
    const t = setup({}, async function* (opts) {
      seen.push(opts);
      if (opts.resume) {
        yield sdkMsg({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          session_id: 'gone',
          num_turns: 0,
          total_cost_usd: 0,
          errors: ['No conversation found with session ID: 2222'],
        });
        return;
      }
      yield sdkMsg({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'fresh',
        session_id: opts.sessionId,
        num_turns: 1,
        total_cost_usd: 0.01,
        errors: [],
      });
    });
    await t.run(base);
    expect(seen).toHaveLength(2);
    expect(seen[0].resume).toBe(base.session.id);
    expect(seen[1].resume).toBeUndefined();
    expect(seen[1].sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1].sessionId).not.toBe(base.session.id);
    expect(t.calls.at(-1)!.body).toMatchObject({
      status: 'completed',
      text: 'fresh',
      sessionId: seen[1].sessionId,
    });

    // thrown variant, and no retry when it is not a missing session or not a resume
    const thrown = setup({}, async function* (opts) {
      if (opts.resume)
        throw new Error('Claude Code returned an error result: No conversation found');
      yield success('ok');
    });
    await thrown.run(base);
    expect(thrown.calls.at(-1)!.body).toMatchObject({ status: 'completed' });

    let runs = 0;
    const other = setup({}, async function* () {
      runs += 1;
      yield textDelta('x');
      throw new Error('rate limited');
    });
    await other.run(base);
    expect(runs).toBe(1);
    expect(other.calls.at(-1)!.body).toMatchObject({ status: 'failed', error: 'rate limited' });
  });

  it('keeps progress events through 429/5xx and drops them on other 4xx', async () => {
    const workdir = await withWorkdir();
    const a = assignment({ agent: { ...assignment().agent, workdir } });
    let hits = 0;
    const retry = setup(
      {
        '/progress': () =>
          ++hits <= 2
            ? errorResponse(hits === 1 ? 429 : 503, 'busy')
            : envelope({ ok: true, cancelled: false }),
      },
      async function* () {
        yield textDelta('hello');
        await sleep(40);
        yield success('done');
      },
    );
    await retry.run(a);
    const delivered = retry.calls
      .filter((c) => c.path.endsWith('/progress'))
      .flatMap((c) => c.body.events as { kind: string; delta?: string }[]);
    expect(delivered.filter((e) => e.kind === 'text').length).toBeGreaterThanOrEqual(1);
    expect(hits).toBeGreaterThanOrEqual(3);

    let drops = 0;
    const drop = setup(
      { '/progress': () => (drops++, errorResponse(400, 'bad events')) },
      async function* () {
        yield textDelta('x');
        await sleep(40);
        yield success('done');
      },
    );
    await drop.run(a);
    expect(drops).toBe(1); // dropped, not re-sent
    expect(drop.calls.at(-1)!.body).toMatchObject({ status: 'completed' });
  });
});
