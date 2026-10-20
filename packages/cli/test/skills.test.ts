import { mkdtempSync, realpathSync } from 'node:fs';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSkill, syncAgentSkills } from '../src/skills.js';
import type { SkillDef } from '../src/types.js';

const def = (over: Partial<SkillDef> = {}): SkillDef => ({
  slug: 'bao-gia',
  name: 'Báo giá',
  description: 'Use when quoting.\nSecond line: with "quotes"',
  content: '# Báo giá\n\nStep 1.',
  version: 1,
  ...over,
});

function env() {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agent-skills-')));
  return { AGENT_HOME: home } as NodeJS.ProcessEnv;
}

const mtime = async (f: string) => Math.round((await stat(f)).mtimeMs);

describe('syncAgentSkills', () => {
  it('writes the plugin manifest and SKILL.md with safe frontmatter', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def()], e);
    expect(res?.names).toEqual(['workspace:bao-gia']);
    expect(res?.path).toBe(path.join(e.AGENT_HOME!, 'skills', 'ag-1'));
    const manifest = JSON.parse(
      await readFile(path.join(res!.path, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest).toEqual({ name: 'workspace' });
    const md = await readFile(path.join(res!.path, 'skills', 'bao-gia', 'SKILL.md'), 'utf8');
    expect(md).toBe(
      '---\nname: bao-gia\ndescription: "Use when quoting. Second line: with \\"quotes\\""\n---\n\n# Báo giá\n\nStep 1.\n',
    );
    expect(md).toBe(renderSkill(def()));
  });

  it('does not rewrite unchanged skills but rewrites changed ones', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def()], e);
    const file = path.join(res!.path, 'skills', 'bao-gia', 'SKILL.md');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    await syncAgentSkills('ag-1', [def()], e);
    expect(await mtime(file)).toBe(old.getTime());
    await syncAgentSkills('ag-1', [def({ version: 2, content: 'new body' })], e);
    expect(await mtime(file)).toBeGreaterThan(old.getTime());
    expect(await readFile(file, 'utf8')).toContain('new body');
  });

  it('removes skills that are no longer listed, and the plugin when none remain', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    await syncAgentSkills('ag-1', [def()], e);
    await expect(stat(path.join(res!.path, 'skills', 'dich'))).rejects.toThrow();
    expect((await stat(path.join(res!.path, 'skills', 'bao-gia'))).isDirectory()).toBe(true);
    expect(await syncAgentSkills('ag-1', [], e)).toBeNull();
    await expect(stat(res!.path)).rejects.toThrow();
  });

  it('refuses bad slugs, duplicates and unsafe agent ids without writing', async () => {
    const e = env();
    for (const slug of ['../x', 'A', 'a/b', '', '-'.repeat(65), 'a b']) {
      await expect(syncAgentSkills('ag-1', [def({ slug })], e)).rejects.toThrow(/invalid slug/);
    }
    await expect(syncAgentSkills('ag-1', [def(), def()], e)).rejects.toThrow(/duplicate/);
    await expect(syncAgentSkills('../evil', [def()], e)).rejects.toThrow(/unsafe agent id/);
    await expect(stat(path.join(e.AGENT_HOME!, 'skills'))).rejects.toThrow();
  });

  it('treats missing skillDefs as no skills', async () => {
    const e = env();
    await mkdir(path.join(e.AGENT_HOME!, 'skills', 'ag-1'), { recursive: true });
    await writeFile(path.join(e.AGENT_HOME!, 'skills', 'ag-1', 'x'), '');
    expect(await syncAgentSkills('ag-1', undefined, e)).toBeNull();
  });
});
