import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Syncs the agent's skills into a daemon-owned Claude Code plugin at
 * `<agent home>/skills/<agentId>/` (outside the agent's workdir):
 * `.claude-plugin/plugin.json` and `skills/<slug>/SKILL.md`. Unchanged skills (same
 * version and content) are not rewritten, skills that are no longer listed are removed.
 * Returns null when there are no skills. Throws on an unsafe agent id or slug.
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
  const skillsDir = path.join(pluginDir, 'skills');
  if (list.length === 0) {
    await rm(pluginDir, { recursive: true, force: true });
    return null;
  }

  const manifest = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifestText = `${JSON.stringify({ name: SKILLS_PLUGIN }, null, 2)}\n`;
  if ((await readOrNull(manifest)) !== manifestText) await writeAtomic(manifest, manifestText);

  await mkdir(skillsDir, { recursive: true });
  for (const entry of await readdir(skillsDir)) {
    if (!seen.has(entry)) await rm(path.join(skillsDir, entry), { recursive: true, force: true });
  }

  for (const def of list) {
    const dir = path.join(skillsDir, def.slug);
    const text = renderSkill(def);
    const stamp = `${def.version}:${createHash('sha256').update(text).digest('hex')}`;
    const stampFile = path.join(dir, '.version');
    if (
      (await readOrNull(stampFile)) === stamp &&
      (await readOrNull(path.join(dir, 'SKILL.md'))) !== null
    ) {
      continue;
    }
    await writeAtomic(path.join(dir, 'SKILL.md'), text);
    await writeAtomic(stampFile, stamp);
  }

  return { path: pluginDir, names: list.map((d) => `${SKILLS_PLUGIN}:${d.slug}`) };
}
