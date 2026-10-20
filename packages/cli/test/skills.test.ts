import { mkdtempSync, realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralise, renderSkill, syncAgentSkills } from '../src/skills.js';
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

describe('renderSkill', () => {
  it('escapes runs of dashes in the description so they cannot end the frontmatter', () => {
    const md = renderSkill(def({ description: 'Use --- when\n--- quoting ----- ok -- fine' }));
    expect(md.slice(0, md.indexOf('\n---\n\n'))).not.toMatch(/\n---/);
    expect(md.slice(4, md.indexOf('\n---\n\n'))).not.toContain('---');
    // still valid JSON for the YAML double-quoted scalar, with the same text
    const line = md.split('\n')[2]!.replace(/^description: /, '');
    expect(JSON.parse(line)).toBe('Use --- when --- quoting ----- ok -- fine');
  });

  it('neutralises inline shell constructs in content and description', () => {
    const md = renderSkill(
      def({ description: 'x !`id`', content: 'run !`whoami`\n```!\nls\n```\n' }),
    );
    expect(md).not.toContain('!`');
    expect(md).not.toContain('```!');
    expect(md).toContain('! `whoami`');
    expect(md).toContain('``` !\nls');
    expect(neutralise('```!`x`')).toBe('``` ! `x`');
  });
});

const dirs = async (p: string) => (await readdir(p)).sort();

describe('syncAgentSkills', () => {
  it('writes an immutable snapshot with the plugin manifest and SKILL.md', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def()], e);
    expect(res?.names).toEqual(['workspace:bao-gia']);
    expect(path.dirname(res!.path)).toBe(path.join(e.AGENT_HOME!, 'skills', 'ag-1'));
    expect(path.basename(res!.path)).toMatch(/^[0-9a-f]{32}$/);
    const manifest = JSON.parse(
      await readFile(path.join(res!.path, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest).toEqual({ name: 'workspace' });
    const md = await readFile(path.join(res!.path, 'skills', 'bao-gia', 'SKILL.md'), 'utf8');
    expect(md).toBe(
      '---\nname: bao-gia\ndescription: "Use when quoting. Second line: with \\"quotes\\""\n---\n\n# Báo giá\n\nStep 1.\n',
    );
    expect(md).toBe(renderSkill(def()));
    expect(await dirs(res!.path)).toEqual(['.claude-plugin', 'skills']);
    res!.release();
  });

  it('reuses an unchanged snapshot without rewriting and uses a new one for changed content', async () => {
    const e = env();
    const a = await syncAgentSkills('ag-1', [def()], e);
    const file = path.join(a!.path, 'skills', 'bao-gia', 'SKILL.md');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    a!.release();
    const again = await syncAgentSkills('ag-1', [def()], e);
    expect(again!.path).toBe(a!.path);
    expect(await mtime(file)).toBe(old.getTime());
    again!.release();
    const b = await syncAgentSkills('ag-1', [def({ version: 2, content: 'new body' })], e);
    expect(b!.path).not.toBe(a!.path);
    expect(await readFile(path.join(b!.path, 'skills', 'bao-gia', 'SKILL.md'), 'utf8')).toContain(
      'new body',
    );
    // the old snapshot was garbage-collected (no run used it)
    await expect(stat(a!.path)).rejects.toThrow();
    b!.release();
  });

  it('removes all snapshots when no skills remain, and the agent dir', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    res!.release();
    expect(await syncAgentSkills('ag-1', [], e)).toBeNull();
    await expect(stat(path.join(skillsRootOf(e), 'ag-1'))).rejects.toThrow();
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

  it('treats missing skillDefs as no skills and clears leftovers', async () => {
    const e = env();
    await mkdir(path.join(e.AGENT_HOME!, 'skills', 'ag-1'), { recursive: true });
    await writeFile(path.join(e.AGENT_HOME!, 'skills', 'ag-1', 'x'), '');
    expect(await syncAgentSkills('ag-1', undefined, e)).toBeNull();
    await expect(stat(path.join(e.AGENT_HOME!, 'skills', 'ag-1'))).rejects.toThrow();
  });

  it('rebuilds a snapshot whose files were tampered with or that has extra entries', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def()], e);
    res!.release();
    const file = path.join(res!.path, 'skills', 'bao-gia', 'SKILL.md');
    await writeFile(file, 'tampered');
    await mkdir(path.join(res!.path, 'hooks'));
    await writeFile(path.join(res!.path, 'skills', 'bao-gia', 'extra.md'), 'x');
    const again = await syncAgentSkills('ag-1', [def()], e);
    expect(again!.path).toBe(res!.path);
    expect(await readFile(file, 'utf8')).toBe(renderSkill(def()));
    expect(await dirs(again!.path)).toEqual(['.claude-plugin', 'skills']);
    expect(await dirs(path.join(again!.path, 'skills', 'bao-gia'))).toEqual(['SKILL.md']);
    again!.release();
  });

  it('only keeps .claude-plugin and skills: plugin extras in any snapshot are removed', async () => {
    const e = env();
    const a = await syncAgentSkills('ag-1', [def()], e);
    a!.release();
    // stray hooks/commands/agents next to the snapshot, and a stale snapshot with extras
    const agentDir = path.dirname(a!.path);
    await mkdir(path.join(agentDir, 'commands'));
    await mkdir(path.join(agentDir, 'oldhash', 'hooks'), { recursive: true });
    await writeFile(path.join(agentDir, 'hooks.json'), '{}');
    const b = await syncAgentSkills('ag-1', [def()], e);
    expect(await dirs(agentDir)).toEqual([path.basename(b!.path)]);
    expect(await dirs(b!.path)).toEqual(['.claude-plugin', 'skills']);
    b!.release();
  });

  it('replaces symlinks where the daemon expects its own directories, without writing through', async () => {
    const e = env();
    const outside = path.join(e.AGENT_HOME!, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'SKILL.md'), 'secret');
    const a = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    a!.release();
    const skills = path.join(a!.path, 'skills');
    await rm(path.join(skills, 'bao-gia'), { recursive: true });
    await symlink(outside, path.join(skills, 'bao-gia'));
    await rm(path.join(skills, 'dich', 'SKILL.md'));
    await symlink(path.join(outside, 'SKILL.md'), path.join(skills, 'dich', 'SKILL.md'));
    let r = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    r!.release();
    for (const slug of ['bao-gia', 'dich']) {
      expect((await lstat(path.join(skills, slug))).isDirectory()).toBe(true);
      expect((await lstat(path.join(skills, slug, 'SKILL.md'))).isFile()).toBe(true);
    }
    expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('secret');

    // snapshot dir, skills dir and agent dir as symlinks
    await rm(skills, { recursive: true });
    await symlink(outside, skills);
    r = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    r!.release();
    expect((await lstat(skills)).isDirectory()).toBe(true);
    await rm(a!.path, { recursive: true });
    await symlink(outside, a!.path);
    r = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    r!.release();
    expect((await lstat(a!.path)).isDirectory()).toBe(true);
    const agentDir = path.dirname(a!.path);
    await rm(agentDir, { recursive: true });
    await symlink(outside, agentDir);
    r = await syncAgentSkills('ag-1', [def()], e);
    r!.release();
    expect((await lstat(agentDir)).isDirectory()).toBe(true);
    expect(await readdir(outside)).toEqual(['SKILL.md']);
    expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('secret');
  });

  it('removes stale entries without following symlinks', async () => {
    const e = env();
    const outside = path.join(e.AGENT_HOME!, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    const a = await syncAgentSkills('ag-1', [def()], e);
    a!.release();
    const agentDir = path.dirname(a!.path);
    await symlink(outside, path.join(agentDir, 'stale-link'));
    await mkdir(path.join(agentDir, 'stale-dir'));
    await symlink(outside, path.join(agentDir, 'stale-dir', 'inner'));
    await writeFile(path.join(agentDir, 'stale-file'), 'x');
    const b = await syncAgentSkills('ag-1', [def()], e);
    expect(await dirs(agentDir)).toEqual([path.basename(b!.path)]);
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    await expect(readlink(path.join(agentDir, 'stale-link'))).rejects.toThrow();
    b!.release();
  });

  it('keeps the files of overlapping runs with different skill sets until each finishes', async () => {
    const e = env();
    const one = await syncAgentSkills('ag-1', [def({ content: 'one' })], e);
    const two = await syncAgentSkills('ag-1', [def({ slug: 'dich', content: 'two' })], e);
    expect(one!.path).not.toBe(two!.path);
    const f1 = path.join(one!.path, 'skills', 'bao-gia', 'SKILL.md');
    const f2 = path.join(two!.path, 'skills', 'dich', 'SKILL.md');
    expect(await readFile(f1, 'utf8')).toContain('one');
    expect(await readFile(f2, 'utf8')).toContain('two');
    // a third sync does not delete either snapshot while they are in use
    const three = await syncAgentSkills('ag-1', [def({ content: 'three' })], e);
    expect(await readFile(f1, 'utf8')).toContain('one');
    expect(await readFile(f2, 'utf8')).toContain('two');
    one!.release();
    one!.release(); // idempotent
    three!.release();
    const four = await syncAgentSkills('ag-1', [def({ content: 'four' })], e);
    await expect(stat(f1)).rejects.toThrow(); // finished and no longer wanted: collected
    expect(await readFile(f2, 'utf8')).toContain('two'); // still running
    two!.release();
    four!.release();
    const last = await syncAgentSkills('ag-1', [def({ content: 'four' })], e);
    await expect(stat(f2)).rejects.toThrow();
    last!.release();
  });

  it('two runs of the same skill set share one snapshot, kept until both release', async () => {
    const e = env();
    const a = await syncAgentSkills('ag-1', [def()], e);
    const b = await syncAgentSkills('ag-1', [def()], e);
    expect(b!.path).toBe(a!.path);
    a!.release();
    const other = await syncAgentSkills('ag-1', [def({ content: 'other' })], e);
    expect((await stat(a!.path)).isDirectory()).toBe(true);
    b!.release();
    other!.release();
    const x = await syncAgentSkills('ag-1', [def({ content: 'other' })], e);
    await expect(stat(a!.path)).rejects.toThrow();
    x!.release();
  });

  it('never rewrites a tampered snapshot a running run still uses: builds a new dir instead', async () => {
    const e = env();
    const a = await syncAgentSkills('ag-1', [def()], e);
    const file = path.join(a!.path, 'skills', 'bao-gia', 'SKILL.md');
    await writeFile(file, 'tampered');
    const b = await syncAgentSkills('ag-1', [def()], e);
    // the in-use directory is left exactly as it was
    expect(await readFile(file, 'utf8')).toBe('tampered');
    expect(b!.path).not.toBe(a!.path);
    expect(path.dirname(b!.path)).toBe(path.dirname(a!.path));
    expect(await readFile(path.join(b!.path, 'skills', 'bao-gia', 'SKILL.md'), 'utf8')).toBe(
      renderSkill(def()),
    );
    a!.release();
    b!.release();
    // once nothing uses them, the next sync restores the canonical dir and drops the rest
    const c = await syncAgentSkills('ag-1', [def()], e);
    expect(await readFile(path.join(c!.path, 'skills', 'bao-gia', 'SKILL.md'), 'utf8')).toBe(
      renderSkill(def()),
    );
    expect(await readdir(path.join(skillsRootOf(e), 'ag-1'))).toEqual([path.basename(c!.path)]);
    c!.release();
  });

  it('serialises overlapping syncs of the same agent and survives a failing one', async () => {
    const e = env();
    const calls = await Promise.all([
      syncAgentSkills('ag-1', [def({ content: 'one' })], e),
      syncAgentSkills('ag-1', [def({ slug: 'dich', content: 'two' })], e),
      syncAgentSkills('ag-1', [def({ content: 'three' })], e),
      syncAgentSkills('ag-1', [def({ slug: 'dich', content: 'four' })], e),
    ]);
    for (const c of calls) {
      expect(await dirs(path.join(c!.path, 'skills'))).toHaveLength(1);
    }
    expect(await readdir(path.join(skillsRootOf(e), 'ag-1'))).toHaveLength(4);
    calls.forEach((c) => c!.release());
    await expect(syncAgentSkills('ag-1', [def(), def()], e)).rejects.toThrow(/duplicate/);
    const ok = await syncAgentSkills('ag-1', [def()], e);
    expect(ok).not.toBeNull();
    expect(await readdir(path.join(skillsRootOf(e), 'ag-1'))).toHaveLength(1);
    ok!.release();
  });
});

const skillsRootOf = (e: NodeJS.ProcessEnv) => path.join(e.AGENT_HOME!, 'skills');
