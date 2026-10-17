import { mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Expands `~` and resolves to an absolute path. Throws on an empty value. */
export function resolveWorkdir(workdir: string): string {
  const trimmed = (workdir ?? '').trim();
  if (!trimmed) throw new Error('workdir is empty');
  return path.resolve(os.homedir(), expandHome(trimmed));
}

/** True when `child` is strictly inside `root` (the root itself does not count). */
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** realpath of the deepest existing ancestor, with the not-yet-existing tail re-appended. */
async function realpathOfExisting(p: string): Promise<string> {
  const tail: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(await realpath(cur), ...tail.reverse());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const parent = path.dirname(cur);
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === cur) throw err;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

async function resolveRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    const abs = resolveWorkdir(root);
    await mkdir(abs, { recursive: true });
    out.push(await realpath(abs));
  }
  return out;
}

/**
 * Validates a server-supplied workdir against the allowed roots, creates it and
 * returns its canonical (realpath) form. The check runs on the resolved path
 * before anything is created, and again on the realpath after (symlinks).
 */
export async function prepareWorkdir(workdir: string, workdirRoots: string[]): Promise<string> {
  const abs = resolveWorkdir(workdir);
  const roots = await resolveRoots(workdirRoots);
  const outside = () =>
    new Error(`workdir outside allowed roots: ${abs} (allowed: ${roots.join(', ') || 'none'})`);

  const planned = await realpathOfExisting(abs);
  if (!roots.some((r) => isInside(r, planned))) throw outside();
  await mkdir(abs, { recursive: true });
  const real = await realpath(abs);
  if (!roots.some((r) => isInside(r, real))) throw outside();
  return real;
}
