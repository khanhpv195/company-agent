import { realpathSync } from 'node:fs';
import os from 'node:os';
import { agentHome } from './config.js';
import { WORKSPACE_TOOL_PREFIX } from './tools.js';

export const FILE_TOOLS = ['Read', 'Edit', 'Write'] as const;

/**
 * Claude Code path rule for an absolute filesystem path: a leading `//` means
 * "from the filesystem root" (a single `/` would be relative to the project).
 * Windows drive paths become `//c/Users/...`.
 */
export function absoluteRulePath(abs: string): string {
  const posix = abs.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\/(.*)$/.exec(posix);
  if (drive) return `//${drive[1].toLowerCase()}/${drive[2]}`;
  return `//${posix.replace(/^\/+/, '')}`;
}

function tryRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Paths an agent must never read or modify, even if a workdir root covers them. */
export function sensitivePaths(
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const homes = new Set([home, tryRealpath(home)]);
  const out = new Set<string>();
  const agentHomes = new Set([agentHome(env), tryRealpath(agentHome(env))]);
  // Only the config (it holds the API key) is denied inside ~/.agent: a `~/.agent/**` or
  // `~/.agent/*` rule would also cover ~/.agent/agents/**, the default workdir root.
  for (const a of agentHomes) out.add(`${a}/config.json`);
  for (const h of homes) {
    for (const p of [
      '.ssh/**',
      '.claude/**',
      '.claude.json',
      '.aws/**',
      '.gnupg/**',
      '.netrc',
      '.npmrc',
      '.zshrc',
      '.zshenv',
      '.zprofile',
      '.zlogin',
      '.bashrc',
      '.bash_profile',
      '.bash_login',
      '.profile',
      '.config/fish/**',
    ]) {
      out.add(`${h}/${p}`);
    }
  }
  return [...out];
}

export const WRITE_TOOLS = ['Edit', 'Write'] as const;

/** Paths inside the workdir that Edit/Write may not touch. */
export const WORKDIR_GUARDED = [
  '.git/**',
  '.claude/**',
  '.envrc',
  '.vscode/**',
  '.idea/**',
  '.husky/**',
  '.mcp.json',
  // nested copies (a sub-project's hooks and editor config run just as well)
  '**/.git/**',
  '**/.claude/**',
  '**/.husky/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.envrc',
  '**/.mcp.json',
];

export interface PermissionRules {
  allowedTools: string[];
  disallowedTools: string[];
}

export function buildPermissionRules(
  cwd: string,
  opts: {
    extraAllowedTools: string[];
    allowWebFetch: boolean;
    home?: string;
    env?: NodeJS.ProcessEnv;
  },
): PermissionRules {
  const scope = `${absoluteRulePath(cwd)}/**`;
  // Grep/Glob are left on Claude Code's default policy (they run inside cwd and honour the Read
  // deny rules below on a best-effort basis); the SDK documents no path-scoped Grep/Glob rule.
  const allowedTools = [
    ...FILE_TOOLS.map((t) => `${t}(${scope})`),
    `${WORKSPACE_TOOL_PREFIX}*`,
    ...opts.extraAllowedTools,
  ];
  // Inside the workdir: never let the agent plant git hooks, Claude settings/hooks, or editor/shell
  // auto-run config (they execute later with the user's rights).
  const guarded = WORKDIR_GUARDED.map((p) => `${absoluteRulePath(cwd)}/${p}`);
  const denied = sensitivePaths(opts.home, opts.env).map(absoluteRulePath);
  const disallowedTools = [
    ...FILE_TOOLS.flatMap((t) => denied.map((p) => `${t}(${p})`)),
    ...WRITE_TOOLS.flatMap((t) => guarded.map((p) => `${t}(${p})`)),
    ...(opts.allowWebFetch ? [] : ['WebFetch']),
  ];
  return { allowedTools, disallowedTools };
}
