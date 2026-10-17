import { describe, expect, it } from 'vitest';
import { absoluteRulePath, buildPermissionRules } from '../src/permissions.js';

const home = '/Users/test';
const env = { AGENT_HOME: '/Users/test/.agent' };

describe('absoluteRulePath', () => {
  it('uses // for filesystem-absolute paths', () => {
    expect(absoluteRulePath('/Users/a/work')).toBe('//Users/a/work');
    expect(absoluteRulePath('C:\\Users\\a')).toBe('//c/Users/a');
  });
});

describe('buildPermissionRules', () => {
  const rules = buildPermissionRules('/Users/test/.agent/agents/hana', {
    extraAllowedTools: ['Bash(git status *)'],
    allowWebFetch: false,
    home,
    env,
  });

  it('scopes file tools to the workdir and never allows bare ones', () => {
    expect(rules.allowedTools).toEqual([
      'Read(//Users/test/.agent/agents/hana/**)',
      'Edit(//Users/test/.agent/agents/hana/**)',
      'Write(//Users/test/.agent/agents/hana/**)',
      'mcp__workspace__*',
      'Bash(git status *)',
    ]);
    for (const bare of ['Read', 'Edit', 'Write', 'Grep', 'Glob']) {
      expect(rules.allowedTools).not.toContain(bare);
    }
  });

  it('denies secrets and shell rc files for Read, Edit and Write', () => {
    for (const tool of ['Read', 'Edit', 'Write']) {
      for (const p of [
        '.agent/config.json',
        '.ssh/**',
        '.claude/**',
        '.zshrc',
        '.bashrc',
        '.bash_profile',
        '.profile',
      ]) {
        expect(rules.disallowedTools).toContain(`${tool}(//Users/test/${p})`);
      }
    }
    // the default workdir root lives in ~/.agent, so it must not be denied wholesale
    expect(rules.disallowedTools).not.toContain('Read(//Users/test/.agent/**)');
    expect(rules.disallowedTools).toContain('WebFetch');
  });

  it('lets WebFetch through when enabled', () => {
    const r = buildPermissionRules('/w', { extraAllowedTools: [], allowWebFetch: true, home, env });
    expect(r.disallowedTools).not.toContain('WebFetch');
  });
});
