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

  it('rewrites a skill whose SKILL.md on disk was changed, even with the same version', async () => {
    const e = env();
    const res = await syncAgentSkills('ag-1', [def()], e);
    const file = path.join(res!.path, 'skills', 'bao-gia', 'SKILL.md');
    await writeFile(file, 'tampered');
    await syncAgentSkills('ag-1', [def()], e);
    expect(await readFile(file, 'utf8')).toBe(renderSkill(def()));
  });

  it('replaces a skill directory or SKILL.md that is a symlink, without writing through it', async () => {
    const e = env();
    const outside = path.join(e.AGENT_HOME!, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'SKILL.md'), 'secret');
    const res = await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    const skills = path.join(res!.path, 'skills');
    await rm(path.join(skills, 'bao-gia'), { recursive: true });
    await symlink(outside, path.join(skills, 'bao-gia'));
    await rm(path.join(skills, 'dich', 'SKILL.md'));
    await symlink(path.join(outside, 'SKILL.md'), path.join(skills, 'dich', 'SKILL.md'));

    await syncAgentSkills('ag-1', [def(), def({ slug: 'dich' })], e);
    for (const slug of ['bao-gia', 'dich']) {
      expect((await lstat(path.join(skills, slug))).isDirectory()).toBe(true);
      expect((await lstat(path.join(skills, slug, 'SKILL.md'))).isFile()).toBe(true);
    }
    expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('secret');
    expect(await readFile(path.join(skills, 'dich', 'SKILL.md'), 'utf8')).toContain('name: dich');
  });

  it('replaces a skill path that is a plain file, and a symlinked skills dir or plugin dir', async () => {
    const e = env();
    const outside = path.join(e.AGENT_HOME!, 'outside');
    await mkdir(outside);
    const res = await syncAgentSkills('ag-1', [def()], e);
    await rm(path.join(res!.path, 'skills', 'bao-gia'), { recursive: true });
    await writeFile(path.join(res!.path, 'skills', 'bao-gia'), 'file');
    await syncAgentSkills('ag-1', [def()], e);
    expect((await lstat(path.join(res!.path, 'skills', 'bao-gia'))).isDirectory()).toBe(true);

    await rm(path.join(res!.path, 'skills'), { recursive: true });
    await symlink(outside, path.join(res!.path, 'skills'));
    await syncAgentSkills('ag-1', [def()], e);
    expect((await lstat(path.join(res!.path, 'skills'))).isDirectory()).toBe(true);

    await rm(res!.path, { recursive: true });
    await symlink(outside, res!.path);
    await syncAgentSkills('ag-1', [def()], e);
    expect((await lstat(res!.path)).isDirectory()).toBe(true);
    expect((await readdir(outside)).length).toBe(0);
  });

  it('removes stale entries without following symlinks', async () => {
    const e = env();
    const outside = path.join(e.AGENT_HOME!, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    const res = await syncAgentSkills('ag-1', [def()], e);
    const skills = path.join(res!.path, 'skills');
    await symlink(outside, path.join(skills, 'stale-link'));
    await mkdir(path.join(skills, 'stale-dir'));
    await symlink(outside, path.join(skills, 'stale-dir', 'inner'));
    await writeFile(path.join(skills, 'stale-file'), 'x');
    await syncAgentSkills('ag-1', [def()], e);
    expect(await readdir(skills)).toEqual(['bao-gia']);
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    await expect(readlink(path.join(skills, 'stale-link'))).rejects.toThrow();
  });

  it('serialises overlapping syncs of the same agent', async () => {
    const e = env();
    const calls = [
      syncAgentSkills('ag-1', [def({ version: 1, content: 'one' })], e),
      syncAgentSkills('ag-1', [def({ slug: 'dich', content: 'two' })], e),
      syncAgentSkills('ag-1', [def({ version: 3, content: 'three' })], e),
      syncAgentSkills('ag-1', [def({ slug: 'dich', content: 'four' })], e),
    ];
    await Promise.all(calls);
    // the last call wins completely: no leftovers or half-written files from the others
    const skills = path.join(skillsRootOf(e), 'ag-1', 'skills');
    expect(await readdir(skills)).toEqual(['dich']);
    expect(await readFile(path.join(skills, 'dich', 'SKILL.md'), 'utf8')).toContain('four');
    // a failing sync does not block the next one
    await expect(syncAgentSkills('ag-1', [def(), def()], e)).rejects.toThrow(/duplicate/);
    expect(await syncAgentSkills('ag-1', [def()], e)).not.toBeNull();
  });
});

const skillsRootOf = (e: NodeJS.ProcessEnv) => path.join(e.AGENT_HOME!, 'skills');
