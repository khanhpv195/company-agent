import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { connectCommand, disconnectCommand, isInsecureRemote } from '../src/commands.js';
import { loadConfig } from '../src/config.js';
import { envelope, errorResponse, fakeFetch } from './helpers.js';

let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  env = { AGENT_HOME: path.join(await mkdtemp(path.join(os.tmpdir(), 'agent-cli-')), 'home') };
});

const paired = {
  computerId: 'c-1',
  apiKey: 'agk_secret',
  workspace: { id: 'w-1', name: 'Acme', slug: 'acme' },
};

describe('connect', () => {
  it('pairs, writes config with mode 0600 and sends os/name/version', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/gateway/pair': () => envelope(paired) });
    const lines: string[] = [];
    await connectCommand(
      { server: 'http://localhost:3000/', code: 'abcd-efgh', name: 'My Mac' },
      { fetchImpl, env, out: (l) => lines.push(l) },
    );

    expect(calls[0].path).toBe('/gateway/pair');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toMatchObject({ code: 'ABCD-EFGH', name: 'My Mac', cliVersion: '0.1.0' });
    expect(String(calls[0].body.os)).toContain(os.platform());

    const file = path.join(env.AGENT_HOME!, 'config.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({
      server: 'http://localhost:3000',
      apiKey: 'agk_secret',
      computerId: 'c-1',
    });
    expect((await loadConfig(env))?.maxChats).toBe(3);
    expect(lines.join('\n')).not.toContain('agk_secret');
  });

  it('defaults the name to the hostname', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/gateway/pair': () => envelope(paired) });
    await connectCommand(
      { server: 'http://x', code: 'AAAA-BBBB' },
      { fetchImpl, env, out: () => {} },
    );
    expect(calls[0].body.name).toBe(os.hostname());
  });

  it('surfaces an invalid code and writes nothing', async () => {
    const { fetchImpl } = fakeFetch({
      '/gateway/pair': () => errorResponse(401, 'Invalid pairing code'),
    });
    await expect(
      connectCommand({ server: 'http://x', code: 'NOPE' }, { fetchImpl, env, out: () => {} }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await loadConfig(env)).toBeNull();
  });

  it('keeps user settings on re-pair and disconnect deletes the file', async () => {
    const { fetchImpl } = fakeFetch({ '/gateway/pair': () => envelope(paired) });
    await connectCommand(
      { server: 'http://x', code: 'AAAA-BBBB' },
      { fetchImpl, env, out: () => {} },
    );
    const file = path.join(env.AGENT_HOME!, 'config.json');
    const cfg = JSON.parse(await readFile(file, 'utf8'));
    cfg.extraAllowedTools = ['Bash(git status *)'];
    await (await import('node:fs/promises')).writeFile(file, JSON.stringify(cfg));
    await connectCommand(
      { server: 'http://x', code: 'CCCC-DDDD' },
      { fetchImpl, env, out: () => {} },
    );
    expect((await loadConfig(env))?.extraAllowedTools).toEqual(['Bash(git status *)']);

    expect(await disconnectCommand({ env, out: () => {} })).toBe(true);
    expect(await loadConfig(env)).toBeNull();
    expect(await disconnectCommand({ env, out: () => {} })).toBe(false);
  });
});

describe('connect transport warning', () => {
  it('flags http:// to non-local hosts only', () => {
    expect(isInsecureRemote('http://example.com')).toBe(true);
    expect(isInsecureRemote('http://192.168.1.5:3000')).toBe(true);
    expect(isInsecureRemote('https://example.com')).toBe(false);
    expect(isInsecureRemote('http://localhost:3000')).toBe(false);
    expect(isInsecureRemote('http://127.0.0.1:3000')).toBe(false);
    expect(isInsecureRemote('http://[::1]:3000')).toBe(false);
  });

  it('prints the warning during connect', async () => {
    const env = { AGENT_HOME: path.join(await mkdtemp(path.join(os.tmpdir(), 'agent-cli-')), 'h') };
    const { fetchImpl } = fakeFetch({ '/gateway/pair': () => envelope(paired) });
    const lines: string[] = [];
    await connectCommand(
      { server: 'http://example.com', code: 'AAAA-BBBB' },
      { fetchImpl, env, out: (l) => lines.push(l) },
    );
    expect(lines[0]).toMatch(/Warning.*http:\/\/.*https/);
  });
});
