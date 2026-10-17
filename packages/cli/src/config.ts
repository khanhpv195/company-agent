import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const configSchema = z.object({
  server: z.string().url(),
  apiKey: z.string().min(1),
  computerId: z.string().min(1),
  workspace: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  /** Extra Claude Code permission rules, e.g. `Bash(git status *)`. */
  extraAllowedTools: z.array(z.string()).default([]),
  /** WebFetch is denied unless this is true. */
  allowWebFetch: z.boolean().default(false),
  /**
   * Agent working directories must live inside one of these (`~` expanded). The server
   * chooses each agent's workdir, so this is what keeps it from pointing at `/` or `~`.
   */
  workdirRoots: z.array(z.string().min(1)).min(1).default(['~/.agent/agents']),
  /** Max concurrent chat replies on this machine. */
  maxChats: z.number().int().min(1).max(10).default(3),
});

export type AgentConfig = z.infer<typeof configSchema>;

export function agentHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_HOME ? path.resolve(env.AGENT_HOME) : path.join(os.homedir(), '.agent');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentHome(env), 'config.json');
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentConfig | null> {
  let raw: string;
  try {
    raw = await readFile(configPath(env), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = configSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid ${configPath(env)}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data;
}

export async function saveConfig(
  config: AgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const file = configPath(env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFile's mode only applies on creation; enforce it for an existing file too.
  await chmod(file, 0o600);
  return file;
}

export async function deleteConfig(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const file = configPath(env);
  try {
    await readFile(file);
  } catch {
    return false;
  }
  await rm(file);
  return true;
}
