import { createHash, randomUUID } from 'node:crypto';
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
  /** Call (once) when the run that uses this snapshot has ended, so it can be garbage-collected. */
  release: () => void;
}

export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentHome(env), 'skills');
}

/** SKILL.md text: YAML frontmatter (`name`, `description`) followed by the body. */
export function renderSkill(def: SkillDef): string {
  // JSON strings are valid YAML double-quoted scalars; newlines in the description are folded.
  const description = neutralise(def.description.replace(/\s+/g, ' ').trim());
  // A run of 3+ dashes could read as a frontmatter delimiter: write each dash as a \u002d escape.
  const quoted = JSON.stringify(description).replace(/-{3,}/g, (m) => '\\u002d'.repeat(m.length));
  return `---\nname: ${def.slug}\ndescription: ${quoted}\n---\n\n${neutralise(def.content)}\n`;
}

/**
 * Claude Code runs inline shell in skills (`!` + backtick commands and fenced blocks opened
 * with three backticks and `!`) when a skill loads; break both constructs so they stay text.
 */
export function neutralise(text: string): string {
  return text.replace(/```!/g, '``` !').replace(/!`/g, '! `');
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

/** Snapshot dirs in use by running runs (path -> number of runs). */
const inUse = new Map<string, number>();

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

const MANIFEST_TEXT = `${JSON.stringify({ name: SKILLS_PLUGIN }, null, 2)}\n`;

/** Content hash of a skill set: the sorted slugs with their rendered SKILL.md text. */
function snapshotHash(list: SkillDef[]): string {
  const h = createHash('sha256');
  for (const d of [...list].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    h.update(JSON.stringify([d.slug, renderSkill(d)]));
  }
  return h.digest('hex').slice(0, 32);
}

async function listDir(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

/**
 * True when `dir` is exactly the expected snapshot: only `.claude-plugin` (with the manifest)
 * and `skills` (with the listed skills), all real directories and regular files.
 */
async function snapshotIsValid(dir: string, list: SkillDef[]): Promise<boolean> {
  const st = await lstat(dir).catch(() => null);
  if (!st || !st.isDirectory()) return false;
  if ((await listDir(dir)).sort().join('|') !== ['.claude-plugin', 'skills'].join('|'))
    return false;
  const manifestDir = path.join(dir, '.claude-plugin');
  if (!(await lstat(manifestDir)).isDirectory()) return false;
  if ((await listDir(manifestDir)).join('|') !== 'plugin.json') return false;
  if ((await readOrNull(path.join(manifestDir, 'plugin.json'))) !== MANIFEST_TEXT) return false;
  const skillsDir = path.join(dir, 'skills');
  const sst = await lstat(skillsDir).catch(() => null);
  if (!sst || !sst.isDirectory()) return false;
  const slugs = list.map((d) => d.slug).sort();
  if ((await listDir(skillsDir)).sort().join('|') !== slugs.join('|')) return false;
  for (const def of list) {
    const sd = path.join(skillsDir, def.slug);
    if (!(await lstat(sd)).isDirectory()) return false;
    if ((await listDir(sd)).join('|') !== 'SKILL.md') return false;
    if ((await readOrNull(path.join(sd, 'SKILL.md'))) !== renderSkill(def)) return false;
  }
  return true;
}

async function writeSnapshot(tmp: string, list: SkillDef[]): Promise<void> {
  await mkdir(path.join(tmp, '.claude-plugin'), { recursive: true });
  await writeAtomic(path.join(tmp, '.claude-plugin', 'plugin.json'), MANIFEST_TEXT);
  for (const def of list) {
    await writeAtomic(path.join(tmp, 'skills', def.slug, 'SKILL.md'), renderSkill(def));
  }
}

/**
 * Gives the agent's skills an immutable snapshot, a full Claude Code plugin at
 * `<agent home>/skills/<agentId>/<hash>/` (outside the agent's workdir): `.claude-plugin/plugin.json`
 * and `skills/<slug>/SKILL.md`, and nothing else (hooks, commands or agents would be loaded by
 * Claude Code). The hash covers the whole skill set, so runs with different sets never touch
 * each other's files. A snapshot that is missing or differs from the expected content is
 * rebuilt (symlinks are never followed); snapshots of other sets, and any stray entry in the
 * agent directory, are removed unless a running run still uses them. Syncs of the same agent
 * run one after another. Returns null when there are no skills. The caller must call
 * `release()` when its run ends. Throws on an unsafe agent id or slug.
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

  const agentDir = path.join(skillsRoot(env), agentId);
  return exclusive(agentDir, () => syncLocked(agentDir, list));
}

async function syncLocked(agentDir: string, list: SkillDef[]): Promise<SkillsPlugin | null> {
  const keep = list.length ? snapshotHash(list) : null;

  const st = await lstat(agentDir).catch(() => null);
  if (st && !st.isDirectory()) await rm(agentDir, { recursive: true, force: true });
  if (!st && keep === null) return null;
  await mkdir(agentDir, { recursive: true });

  // Garbage-collect everything but the wanted snapshot and snapshots of running runs.
  for (const entry of await readdir(agentDir)) {
    const full = path.join(agentDir, entry);
    if (entry === keep || (inUse.get(full) ?? 0) > 0) continue;
    // rm never follows a symlink: it removes the link itself.
    await rm(full, { recursive: true, force: true });
  }
  if (keep === null) {
    if ((await readdir(agentDir)).length === 0)
      await rm(agentDir, { recursive: true, force: true });
    return null;
  }

  const dir = path.join(agentDir, keep);
  if (!(await snapshotIsValid(dir, list))) {
    const tmp = path.join(agentDir, `.tmp-${randomUUID()}`);
    try {
      await writeSnapshot(tmp, list);
      await rm(dir, { recursive: true, force: true });
      await rename(tmp, dir);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw err;
    }
  }

  inUse.set(dir, (inUse.get(dir) ?? 0) + 1);
  let released = false;
  return {
    path: dir,
    names: list.map((d) => `${SKILLS_PLUGIN}:${d.slug}`),
    release: () => {
      if (released) return;
      released = true;
      const n = (inUse.get(dir) ?? 1) - 1;
      if (n <= 0) inUse.delete(dir);
      else inUse.set(dir, n);
    },
  };
}
