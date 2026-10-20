import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentHome } from './config.js';
import type { SkillDef } from './types.js';

/** Name of the daemon-owned plugin; its skills are addressed as `workspace:<slug>`. */
export const SKILLS_PLUGIN = 'workspace';

const SLUG = /^[a-z0-9-]{1,64}$/;
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface SkillsPlugin {
  /** Plugin directory to pass as `plugins: [{ type: 'local', path }]`. */
  path: string;
  /** Names for the SDK `skills` option (`workspace:<slug>`). */
  names: string[];
}

export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentHome(env), 'skills');
}

/** SKILL.md text: YAML frontmatter (`name`, `description`) followed by the body. */
export function renderSkill(def: SkillDef): string {
  // JSON strings are valid YAML double-quoted scalars; newlines in the description are folded.
  const description = def.description.replace(/\s+/g, ' ').trim();
  return `---\nname: ${def.slug}\ndescription: ${JSON.stringify(description)}\n---\n\n${def.content}\n`;
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** The text of a regular file; null when missing or when it is a symlink/directory/etc. */
async function readOrNull(file: string): Promise<string | null> {
  try {
    if (!(await lstat(file)).isFile()) return null;
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Makes `dir` a real directory (not a symlink, not a file): anything else is removed first.
 * `rm` unlinks a symlink itself and never follows it.
 */
async function ensureRealDir(dir: string): Promise<void> {
  const st = await lstat(dir).catch(() => null);
  if (st && !st.isDirectory()) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/** Removes `file` unless it is a regular file (a symlink or directory in its place). */
async function dropIfNotFile(file: string): Promise<void> {
  const st = await lstat(file).catch(() => null);
  if (st && !st.isFile()) await rm(file, { recursive: true, force: true });
}

/** One sync at a time per agent directory, so overlapping runs cannot interleave. */
const tails = new Map<string, Promise<unknown>>();

function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/**
 * Syncs the agent's skills into a daemon-owned Claude Code plugin at
 * `<agent home>/skills/<agentId>/` (outside the agent's workdir):
 * `.claude-plugin/plugin.json` and `skills/<slug>/SKILL.md`. A skill is left alone only when its
 * SKILL.md on disk already equals the expected text; skills that are no longer listed are
 * removed. Symlinks and non-directories where the daemon expects its own directories are
 * replaced, never followed. Syncs of the same agent run one after another. Returns null when
 * there are no skills. Throws on an unsafe agent id or slug.
 */
export async function syncAgentSkills(
  agentId: string,
  defs: SkillDef[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SkillsPlugin | null> {
  const list = defs ?? [];
  if (!AGENT_ID.test(agentId))
    throw new Error(`refusing unsafe agent id: ${JSON.stringify(agentId)}`);
  const seen = new Set<string>();
  for (const d of list) {
    if (typeof d.slug !== 'string' || !SLUG.test(d.slug)) {
      throw new Error(`refusing skill with invalid slug: ${JSON.stringify(d.slug)}`);
    }
    if (seen.has(d.slug)) throw new Error(`duplicate skill slug: ${d.slug}`);
    seen.add(d.slug);
  }

  const pluginDir = path.join(skillsRoot(env), agentId);
  return exclusive(pluginDir, () => syncLocked(pluginDir, list, seen));
}

async function syncLocked(
  pluginDir: string,
  list: SkillDef[],
  seen: Set<string>,
): Promise<SkillsPlugin | null> {
  const skillsDir = path.join(pluginDir, 'skills');
  if (list.length === 0) {
    await rm(pluginDir, { recursive: true, force: true });
    return null;
  }

  await ensureRealDir(pluginDir);
  const manifestDir = path.join(pluginDir, '.claude-plugin');
  await ensureRealDir(manifestDir);
  const manifest = path.join(manifestDir, 'plugin.json');
  const manifestText = `${JSON.stringify({ name: SKILLS_PLUGIN }, null, 2)}\n`;
  if ((await readOrNull(manifest)) !== manifestText) {
    await dropIfNotFile(manifest);
    await writeAtomic(manifest, manifestText);
  }

  await ensureRealDir(skillsDir);
  for (const entry of await readdir(skillsDir)) {
    // rm never follows a symlink: it removes the link itself.
    if (!seen.has(entry)) await rm(path.join(skillsDir, entry), { recursive: true, force: true });
  }

  for (const def of list) {
    const dir = path.join(skillsDir, def.slug);
    await ensureRealDir(dir);
    const file = path.join(dir, 'SKILL.md');
    const text = renderSkill(def);
    if ((await readOrNull(file)) === text) continue;
    await dropIfNotFile(file);
    await writeAtomic(file, text);
  }

  return { path: pluginDir, names: list.map((d) => `${SKILLS_PLUGIN}:${d.slug}`) };
}
