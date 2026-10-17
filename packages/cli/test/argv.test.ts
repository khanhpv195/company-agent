import { describe, expect, it } from 'vitest';
import { normalizeArgv } from '../src/argv.js';

describe('normalizeArgv', () => {
  it('drops the pnpm-forwarded `--` right after the script path', () => {
    expect(
      normalizeArgv(['/usr/bin/node', '/app/dist/main.js', '--', 'connect', '--server', 'x']),
    ).toEqual(['/usr/bin/node', '/app/dist/main.js', 'connect', '--server', 'x']);
  });

  it('leaves argv without a separator untouched', () => {
    const argv = ['node', 'main.js', 'connect', '--code', 'AAAA-AAAA'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it('keeps a `--` that appears later (only the leading one is pnpm noise)', () => {
    expect(normalizeArgv(['node', 'main.js', 'start', '--', 'x'])).toEqual([
      'node',
      'main.js',
      'start',
      '--',
      'x',
    ]);
  });

  it('does not mutate the input array', () => {
    const argv = ['node', 'main.js', '--', 'status'];
    normalizeArgv(argv);
    expect(argv).toEqual(['node', 'main.js', '--', 'status']);
  });
});
