import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { ApiError, type GatewayClient } from './api.js';
import type { AgentConfig } from './config.js';
import { errorMessage, type Logger } from './log.js';
import { buildPermissionRules } from './permissions.js';
import { SKILLS_PLUGIN, syncAgentSkills, type SkillsPlugin } from './skills.js';
import { coalesce, StreamMapper } from './stream.js';
import { createWorkspaceServer, WORKSPACE_SERVER } from './tools.js';
import { prepareWorkdir } from './workdir.js';
import type { GatewayAssignment, GatewayEvent, GatewayResult } from './types.js';

export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export interface RunTiming {
  flushMs: number;
  leaseMs: number;
  /** First retry delay for progress posts (doubles up to 8 s). */
  retryBaseMs: number;
}

export interface RunnerDeps {
  client: GatewayClient;
  config: Pick<AgentConfig, 'extraAllowedTools' | 'allowWebFetch' | 'workdirRoots'>;
  query: QueryFn;
  log: Logger;
  timing?: Partial<RunTiming>;
}

/** Abort reasons (set as `abortController.signal.reason`). */
export const ABORT_CANCELLED = 'cancelled';
export const ABORT_SHUTDOWN = 'shutdown';

export { expandHome, resolveWorkdir } from './workdir.js';

/** Matches the CLI's error when a `resume` session id is unknown on this machine. */
export const SESSION_MISSING = /no conversation found/i;

export function buildSystemAppend(a: GatewayAssignment): string {
  const who = a.requestedBy
    ? `${a.requestedBy.name} (${a.requestedBy.role})`
    : 'nobody in particular (automated run)';
  return [
    `You are "${a.agent.name}", an AI agent working inside a team workspace.`,
    a.agent.persona ? `## Persona\n${a.agent.persona}` : '',
    a.context ? `## Context\n${a.context}` : '',
    '## Rules',
    `- You act on behalf of ${who}. The "${WORKSPACE_SERVER}" tools (mcp__${WORKSPACE_SERVER}__*) read and change the workspace with that person's permissions; if one is refused, say so instead of retrying.`,
    '- Keep files you create inside your working directory.',
    a.kind === 'chat'
      ? '- This is a chat: answer concisely in markdown, in the language the user writes in.'
      : '- This is a task run: do the work, then finish with a short markdown summary of what you did.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildOptions(
  a: GatewayAssignment,
  deps: RunnerDeps,
  cwd: string,
  abortController: AbortController,
  session: { id: string; resume: boolean } = a.session,
  skills: SkillsPlugin | null = null,
): Options {
  const rules = buildPermissionRules(cwd, deps.config);
  return {
    cwd,
    ...(session.resume ? { resume: session.id } : { sessionId: session.id }),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: buildSystemAppend(a) },
    maxTurns: a.agent.maxTurns,
    permissionMode: 'dontAsk',
    settingSources: [],
    includePartialMessages: true,
    abortController,
    allowedTools: rules.allowedTools,
    disallowedTools: rules.disallowedTools,
    mcpServers: { [WORKSPACE_SERVER]: createWorkspaceServer(deps.client, a) },
    ...(skills
      ? {
          plugins: [{ type: 'local' as const, path: skills.path, skipMcpDiscovery: true }],
          skills: skills.names,
        }
      : {}),
  };
}

/**
 * The SDK `system` init message lists the plugins that loaded and the load errors; a plugin
 * that failed (or a path that vanished) is only reported there, so warn but never fail the run.
 */
export function checkSkillsPlugin(msg: SDKMessage, agentId: string, log: Logger): void {
  if (msg.type !== 'system' || msg.subtype !== 'init') return;
  const errors = (msg.plugin_errors ?? []).filter(
    (e) => e.plugin === SKILLS_PLUGIN || e.plugin.startsWith(`${SKILLS_PLUGIN}@`),
  );
  const loaded = msg.plugins?.some((p) => p.name === SKILLS_PLUGIN) ?? false;
  if (loaded && errors.length === 0) return;
  const detail = errors.length
    ? errors.map((e) => `${e.type}: ${e.message}`).join('; ')
    : 'plugin not listed as loaded';
  log(
    'warn',
    `skills plugin "${SKILLS_PLUGIN}" of agent ${agentId} did not load cleanly: ${detail}`,
  );
}

function isGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 404);
}

/** 4xx other than "slow down / timed out": retrying the same payload cannot succeed. */
export function isPermanentClientError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

export const MAX_BODY_BYTES = 900 * 1024;
const RESULT_RETRY_TEXT_BYTES = 50 * 1024;
const CUT_MARK = '…(đã cắt)';

/** Trims `text` to at most `max` UTF-8 bytes (mark included), appending a cut marker. */
export function trimBytes(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  const budget = Math.max(0, max - Buffer.byteLength(CUT_MARK));
  let out = text.slice(0, budget);
  while (out.length > 0 && Buffer.byteLength(out) > budget) out = out.slice(0, -1);
  // do not end on half a surrogate pair
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  return out + CUT_MARK;
}

function splitText(text: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    let n = Math.min(rest.length, maxBytes);
    while (n > 1 && Buffer.byteLength(rest.slice(0, n)) > maxBytes) n = Math.floor(n * 0.9);
    if (/[\ud800-\udbff]$/.test(rest.slice(0, n)) && n > 1) n -= 1;
    parts.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return parts;
}

/** Splits events into batches whose JSON stays under `maxBytes` (oversized text is cut up). */
export function splitBatches(events: GatewayEvent[], maxBytes = MAX_BODY_BYTES): GatewayEvent[][] {
  const size = (e: GatewayEvent) => Buffer.byteLength(JSON.stringify(e)) + 1;
  const batches: GatewayEvent[][] = [];
  let cur: GatewayEvent[] = [];
  let curBytes = 0;
  const push = (e: GatewayEvent) => {
    const b = size(e);
    if (cur.length > 0 && curBytes + b > maxBytes) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(e);
    curBytes += b;
  };
  for (const e of events) {
    if (e.kind === 'text' && size(e) > maxBytes) {
      // leave room for JSON escaping (worst case 6x for control chars is unrealistic; 2x is ample)
      for (const part of splitText(e.delta, Math.floor(maxBytes / 2))) {
        push({ kind: 'text', delta: part });
      }
    } else push(e);
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function postResult(
  client: GatewayClient,
  id: string,
  result: GatewayResult,
  log: Logger,
): Promise<void> {
  let payload: GatewayResult = result.text
    ? { ...result, text: trimBytes(result.text, MAX_BODY_BYTES) }
    : result;
  let shrunk = false;
  for (let i = 0; i < 3; i++) {
    try {
      await client.result(id, payload);
      return;
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 413 || err.status === 400) &&
        !shrunk &&
        payload.text
      ) {
        shrunk = true;
        payload = { ...payload, text: trimBytes(payload.text, RESULT_RETRY_TEXT_BYTES) };
        log('warn', `result for ${id} rejected (${err.message}), retrying with shorter text`);
        continue;
      }
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        log('warn', `result for ${id} rejected: ${err.message}`);
        return;
      }
      log('warn', `result for ${id} failed (${errorMessage(err)}), retry ${i + 1}/3`);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  log('error', `gave up reporting result for ${id}`);
}

/**
 * Runs one claimed assignment end to end. Resolves when the result has been
 * reported (or deliberately not, when the server cancelled it).
 */
export async function runAssignment(
  a: GatewayAssignment,
  deps: RunnerDeps,
  abort: AbortController,
): Promise<void> {
  const { client, log } = deps;
  const timing: RunTiming = {
    flushMs: deps.timing?.flushMs ?? 300,
    leaseMs: deps.timing?.leaseMs ?? 2000,
    retryBaseMs: deps.timing?.retryBaseMs ?? 500,
  };

  try {
    await client.accept(a.id, a.attempt);
  } catch (err) {
    log('warn', `accept ${a.id} failed: ${errorMessage(err)}`);
    return;
  }

  let mapper = new StreamMapper(a.kind);
  let buffer: GatewayEvent[] = [];
  let flushing: Promise<void> = Promise.resolve();
  let progressFailures = 0;
  let retryAt = 0;

  const cancel = () => {
    if (!abort.signal.aborted) abort.abort(ABORT_CANCELLED);
  };

  /** One attempt to post buffered events; keeps them for a retry on transient errors. */
  const flushOnce = async (force: boolean): Promise<void> => {
    if (buffer.length === 0) return;
    if (!force && Date.now() < retryAt) return; // backing off
    const batches = splitBatches(coalesce(buffer));
    buffer = [];
    for (let i = 0; i < batches.length; i++) {
      const events = batches[i];
      try {
        const res = await client.progress(a.id, a.attempt, events);
        progressFailures = 0;
        if (res.cancelled) cancel();
      } catch (err) {
        if (isGone(err)) {
          cancel();
          return;
        }
        if (isPermanentClientError(err)) {
          // 401 lands here too: the daemon-level heartbeat sees a revoked key and shuts down,
          // so there is nothing useful to retry for this payload.
          log(
            'warn',
            `progress ${a.id} rejected, dropping ${events.length} event(s): ${errorMessage(err)}`,
          );
          continue;
        }
        // 408/429/5xx/network: keep this and the unsent batches and back off before the next try
        buffer = [...batches.slice(i).flat(), ...buffer].slice(-500);
        progressFailures += 1;
        const delay = Math.min(8000, timing.retryBaseMs * 2 ** (progressFailures - 1));
        retryAt = Date.now() + delay;
        log('warn', `progress ${a.id} failed (${errorMessage(err)}), retrying in ${delay} ms`);
        return;
      }
    }
  };

  const flush = (force = false): Promise<void> => {
    flushing = flushing.then(() => flushOnce(force));
    return flushing;
  };

  /** Last flush: a few forced attempts so a short blip does not lose the tail. */
  const finalFlush = async (): Promise<void> => {
    for (let i = 0; i < 3 && buffer.length > 0 && !abort.signal.aborted; i++) {
      await flush(true);
      if (buffer.length > 0) await sleep(timing.retryBaseMs * (i + 1));
    }
    await flush(true);
  };

  const flushTimer = setInterval(() => void flush(), timing.flushMs);
  let leaseBusy = false;
  const leaseTimer = setInterval(() => {
    if (leaseBusy) return;
    leaseBusy = true;
    client
      .assignmentHeartbeat(a.id, a.attempt)
      .then(
        (res) => {
          if (res.cancelled) cancel();
        },
        (err) => {
          if (isGone(err)) cancel();
          else log('warn', `lease heartbeat ${a.id} failed: ${errorMessage(err)}`);
        },
      )
      .finally(() => {
        leaseBusy = false;
      });
  }, timing.leaseMs);

  let failure: string | undefined;
  let sessionOverride: { id: string; resume: boolean } | undefined;
  try {
    if (!abort.signal.aborted) {
      const cwd = await prepareWorkdir(a.agent.workdir, deps.config.workdirRoots);
      const skills = await syncAgentSkills(a.agent.id, a.agent.skillDefs);
      const consume = async (session: { id: string; resume: boolean }) => {
        const q = deps.query({
          prompt: a.prompt,
          options: buildOptions(a, deps, cwd, abort, session, skills),
        });
        for await (const msg of q) {
          if (skills) checkSkillsPlugin(msg, a.agent.id, log);
          const events = mapper.map(msg);
          if (events.length) buffer.push(...events);
          if (abort.signal.aborted) break;
        }
      };
      const attempt = async (session: {
        id: string;
        resume: boolean;
      }): Promise<string | undefined> => {
        try {
          await consume(session);
        } catch (err) {
          if (!abort.signal.aborted) return errorMessage(err);
        }
        const o = mapper.outcome;
        return o?.status === 'failed' ? o.error : undefined;
      };

      let problem = await attempt(a.session);
      if (
        problem &&
        a.session.resume &&
        SESSION_MISSING.test(problem) &&
        mapper.turns === 0 &&
        !abort.signal.aborted
      ) {
        // The server thinks the session exists but this machine has no transcript for it
        // (new machine, cleaned ~/.claude): start a fresh session and report its id.
        sessionOverride = { id: randomUUID(), resume: false };
        log(
          'warn',
          `session ${a.session.id} not found on this machine, starting ${sessionOverride.id}`,
        );
        mapper = new StreamMapper(a.kind);
        problem = await attempt(sessionOverride);
      }
      if (problem && !mapper.outcome) failure = problem;
    }
  } catch (err) {
    if (!abort.signal.aborted) failure = errorMessage(err);
  } finally {
    clearInterval(flushTimer);
    clearInterval(leaseTimer);
  }

  const sessionId = mapper.sessionId ?? sessionOverride?.id;

  if (abort.signal.aborted) {
    await flush(true);
    if (abort.signal.reason === ABORT_CANCELLED) {
      log('info', `aborted ${a.id} (cancelled by server)`);
      return;
    }
    await postResult(
      client,
      a.id,
      {
        attempt: a.attempt,
        status: 'failed',
        error: 'daemon stopped',
        sessionId,
        numTurns: mapper.turns,
      },
      log,
    );
    return;
  }

  await finalFlush();
  if (abort.signal.aborted && abort.signal.reason === ABORT_CANCELLED) {
    log('info', `aborted ${a.id} (cancelled by server)`);
    return;
  }
  const outcome = mapper.outcome;
  const result: GatewayResult = outcome
    ? { attempt: a.attempt, ...outcome }
    : {
        attempt: a.attempt,
        status: 'failed',
        error: failure ?? 'agent ended without a result',
        sessionId,
        numTurns: mapper.turns,
      };
  log('info', `assignment ${a.id} ${result.status}${result.error ? `: ${result.error}` : ''}`);
  await postResult(client, a.id, result, log);
}
