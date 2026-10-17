import { describe, expect, it } from 'vitest';
import {
  canManageAgents,
  nextAgentAfterDelete,
  parseMaxTurns,
  skillFlags,
  toCreateInput,
  validateAgentForm,
  type AgentFormValues,
} from './agent-form.logic';

const base: AgentFormValues = {
  name: 'Ops Bot',
  computerId: 'c1',
  persona: '',
  workdir: '',
  maxTurns: '',
};

describe('validateAgentForm', () => {
  it('accepts a minimal form', () => {
    expect(validateAgentForm(base, ['Research Bot'], ['c1', 'c2'])).toEqual({});
  });

  it('requires a name within 60 characters', () => {
    expect(validateAgentForm({ ...base, name: '   ' }, [], ['c1']).name).toBeTruthy();
    expect(validateAgentForm({ ...base, name: 'x'.repeat(61) }, [], ['c1']).name).toBeTruthy();
    expect(validateAgentForm({ ...base, name: 'x'.repeat(60) }, [], ['c1']).name).toBeUndefined();
  });

  it('rejects a taken name regardless of case and surrounding spaces', () => {
    const errors = validateAgentForm({ ...base, name: ' research bot ' }, ['Research Bot'], ['c1']);
    expect(errors.name).toBe('Đã có agent trùng tên');
  });

  it('requires a known computer', () => {
    expect(validateAgentForm({ ...base, computerId: '' }, [], ['c1']).computerId).toBeTruthy();
    expect(validateAgentForm({ ...base, computerId: 'zz' }, [], ['c1']).computerId).toBeTruthy();
  });

  it('requires a workdir only when asked to (editing)', () => {
    expect(validateAgentForm(base, [], ['c1'], { requireWorkdir: true }).workdir).toBeTruthy();
    expect(
      validateAgentForm({ ...base, workdir: '~/w' }, [], ['c1'], { requireWorkdir: true }).workdir,
    ).toBeUndefined();
    expect(validateAgentForm(base, [], ['c1']).workdir).toBeUndefined();
  });

  it('validates max turns only when given', () => {
    for (const bad of ['0', '201', '1.5', 'abc', '-3'])
      expect(validateAgentForm({ ...base, maxTurns: bad }, [], ['c1']).maxTurns).toBeTruthy();
    for (const ok of ['', ' ', '1', '200', '40'])
      expect(validateAgentForm({ ...base, maxTurns: ok }, [], ['c1']).maxTurns).toBeUndefined();
  });
});

describe('parseMaxTurns', () => {
  it('parses whole numbers in range', () => {
    expect(parseMaxTurns(' 12 ')).toBe(12);
    expect(parseMaxTurns('0')).toBeNull();
    expect(parseMaxTurns('')).toBeNull();
  });
});

describe('toCreateInput', () => {
  it('leaves empty optional fields out', () => {
    expect(toCreateInput({ ...base, name: '  Ops Bot ' }, undefined)).toEqual({
      name: 'Ops Bot',
      computerId: 'c1',
    });
  });

  it('passes the filled fields and skills', () => {
    const skills = [{ id: 'git-ops', enabled: true }];
    expect(
      toCreateInput({ ...base, persona: 'Be terse', workdir: ' ~/w ', maxTurns: '7' }, skills),
    ).toEqual({
      name: 'Ops Bot',
      computerId: 'c1',
      persona: 'Be terse',
      workdir: '~/w',
      maxTurns: 7,
      skills,
    });
  });
});

describe('helpers', () => {
  it('maps the checked skills to flags', () => {
    const catalog = [
      { id: 'a', name: 'a', enabled: true },
      { id: 'b', name: 'b', enabled: false },
    ];
    expect(skillFlags(catalog, new Set(['b']))).toEqual([
      { id: 'a', enabled: false },
      { id: 'b', enabled: true },
    ]);
  });

  it('lets only owner and admin manage agents', () => {
    expect(canManageAgents('owner')).toBe(true);
    expect(canManageAgents('admin')).toBe(true);
    expect(canManageAgents('member')).toBe(false);
    expect(canManageAgents(undefined)).toBe(false);
  });

  it('picks the first other agent after a delete', () => {
    expect(nextAgentAfterDelete([{ id: 'a' }, { id: 'b' }], 'a')).toBe('b');
    expect(nextAgentAfterDelete([{ id: 'a' }], 'a')).toBeNull();
  });
});
