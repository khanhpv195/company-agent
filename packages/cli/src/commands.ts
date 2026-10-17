import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError, GatewayClient } from './api.js';
import { configPath, deleteConfig, loadConfig, saveConfig, type AgentConfig } from './config.js';
import { Daemon } from './daemon.js';
import { consoleLogger, errorMessage, type Logger } from './log.js';
import type { QueryFn } from './runner.js';

export const CLI_VERSION = '0.1.0';

type Out = (line: string) => void;
const stdout: Out = (line) => process.stdout.write(`${line}\n`);

export interface ConnectOptions {
  server: string;
  code: string;
  name?: string;
}

/** http:// to anything other than this machine. */
export function isInsecureRemote(server: string): boolean {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return !(
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\./.test(host)
  );
}

export async function connectCommand(
  opts: ConnectOptions,
  deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; out?: Out } = {},
): Promise<AgentConfig> {
  const out = deps.out ?? stdout;
  if (isInsecureRemote(opts.server)) {
    out(
      `Warning: ${opts.server} is plain http:// on a non-local host. The API key and everything the agents do travel unencrypted; use https://.`,
    );
  }
  const client = new GatewayClient({ server: opts.server, fetchImpl: deps.fetchImpl });
  const res = await client.pair({
    code: opts.code.trim().toUpperCase(),
    name: opts.name?.trim() || os.hostname(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cliVersion: CLI_VERSION,
  });
  const existing = await loadConfig(deps.env).catch(() => null);
  const config: AgentConfig = {
    server: opts.server.replace(/\/+$/, ''),
    apiKey: res.apiKey,
    computerId: res.computerId,
    workspace: res.workspace,
    extraAllowedTools: existing?.extraAllowedTools ?? [],
    allowWebFetch: existing?.allowWebFetch ?? false,
    workdirRoots: existing?.workdirRoots ?? ['~/.agent/agents'],
    maxChats: existing?.maxChats ?? 3,
  };
  const file = await saveConfig(config, deps.env);
  out(`Connected to workspace "${res.workspace.name}" as computer ${res.computerId}.`);
  out(`Config saved to ${file}`);
  return config;
}

export interface StartDeps {
  query?: QueryFn;
  fetchImpl?: typeof fetch;
  log?: Logger;
  env?: NodeJS.ProcessEnv;
}

/** Starts the daemon; resolves once shutdown completed. */
export async function startCommand(deps: StartDeps = {}): Promise<number> {
  const log = deps.log ?? consoleLogger;
  const config = await loadConfig(deps.env);
  if (!config) {
    log('error', 'Not connected. Run: agent connect --server <url> --code <code>');
    return 1;
  }
  const client = new GatewayClient({
    server: config.server,
    apiKey: config.apiKey,
    fetchImpl: deps.fetchImpl,
  });
  let exitCode = 0;
  let resolveDone!: () => void;
  const finished = new Promise<void>((r) => (resolveDone = r));

  const daemon = new Daemon({
    client,
    config,
    query: deps.query ?? (query as QueryFn),
    log,
    cliVersion: CLI_VERSION,
    maxChats: config.maxChats,
    onFatal: (reason) => {
      log('error', reason);
      exitCode = 1;
      void stop();
    },
  });

  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    log('info', 'shutting down…');
    await daemon.shutdown();
    log('info', 'daemon stopped');
    resolveDone();
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  log('info', `agent daemon connected to ${config.server} (workspace ${config.workspace.name})`);
  await daemon.run();
  await finished;
  return exitCode;
}

export async function statusCommand(
  deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; out?: Out } = {},
): Promise<number> {
  const out = deps.out ?? stdout;
  const env = deps.env ?? process.env;
  const config = await loadConfig(env);
  if (!config) {
    out('Not connected. Run: agent connect --server <url> --code <code>');
    return 1;
  }
  out(`Config:     ${configPath(env)}`);
  out(`Server:     ${config.server}`);
  out(`Workspace:  ${config.workspace.name} (${config.workspace.slug})`);
  out(`Computer:   ${config.computerId}`);
  let code = 0;
  try {
    const client = new GatewayClient({
      server: config.server,
      apiKey: config.apiKey,
      fetchImpl: deps.fetchImpl,
      timeoutMs: 8000,
    });
    const hb = await client.heartbeat(CLI_VERSION);
    out(`Gateway:    reachable, ${hb.agents.length} agent(s) on this computer`);
  } catch (err) {
    code = 1;
    out(
      `Gateway:    ${err instanceof ApiError && err.status === 401 ? 'API key rejected, reconnect with a new code' : errorMessage(err)}`,
    );
  }
  if (env.ANTHROPIC_API_KEY) {
    out('Claude:     using ANTHROPIC_API_KEY');
  } else if (existsSync(path.join(os.homedir(), '.claude'))) {
    out(
      'Claude:     found ~/.claude (uses your Claude Code login; run `claude` once to confirm you are signed in)',
    );
  } else {
    out('Claude:     no login found. Run `claude` and sign in, or set ANTHROPIC_API_KEY.');
    code = 1;
  }
  return code;
}

export async function disconnectCommand(
  deps: { env?: NodeJS.ProcessEnv; out?: Out } = {},
): Promise<boolean> {
  const out = deps.out ?? stdout;
  const removed = await deleteConfig(deps.env);
  out(
    removed
      ? 'Config deleted. Remove the computer from the web app to revoke its key.'
      : 'Not connected.',
  );
  return removed;
}
