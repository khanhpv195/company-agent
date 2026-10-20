import type { Skill } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import {
  atSkillLimit,
  canApproveSkill,
  canEditSkill,
  canSetAgentSkills,
  filterSkills,
  inUseAgents,
  isSkillDirty,
  needsApproval,
  normalizeSkillName,
  slugifySkill,
  toggleId,
  unapprovedIds,
  validateSkillForm,
} from './skills.logic';

const skill = (over: Partial<Skill>): Skill => ({
  id: 's1',
  slug: 'bao-gia',
  name: 'Báo giá',
  description: 'd',
  content: 'c',
  templateId: null,
  version: 1,
  createdById: 'u2',
  updatedById: null,
  updatedAt: '2026-01-01T00:00:00Z',
  trusted: true,
  agentIds: [],
  ...over,
});

describe('slugifySkill', () => {
  it('drops diacritics and symbols', () => {
    expect(slugifySkill('Báo giá khách Đức!')).toBe('bao-gia-khach-duc');
    expect(slugifySkill('***')).toBe('');
    expect(slugifySkill('a'.repeat(100))).toHaveLength(64);
  });
});

describe('permissions', () => {
  it('edits: creator, owner, admin', () => {
    const s = skill({});
    expect(canEditSkill(s, { id: 'u2', role: 'member' })).toBe(true);
    expect(canEditSkill(s, { id: 'u9', role: 'member' })).toBe(false);
    expect(canEditSkill(s, { id: 'u9', role: 'admin' })).toBe(true);
    expect(canEditSkill(s, { id: 'u9', role: 'owner' })).toBe(true);
    expect(canEditSkill(skill({ createdById: null }), { id: 'u9', role: 'member' })).toBe(false);
    expect(canEditSkill(s, undefined)).toBe(false);
  });

  it('agent skills: managers, or a member of the same department', () => {
    expect(canSetAgentSkills({ role: 'admin', departmentId: null }, { departmentId: null })).toBe(
      true,
    );
    expect(canSetAgentSkills({ role: 'member', departmentId: 'd1' }, { departmentId: 'd1' })).toBe(
      true,
    );
    expect(canSetAgentSkills({ role: 'member', departmentId: 'd1' }, { departmentId: 'd2' })).toBe(
      false,
    );
    expect(canSetAgentSkills({ role: 'member', departmentId: null }, { departmentId: null })).toBe(
      false,
    );
  });
});

describe('list helpers', () => {
  const list = [skill({}), skill({ id: 's2', slug: 'git', name: 'Git' })];
  it('filters by name or slug, ignoring case and diacritics', () => {
    expect(filterSkills(list, 'BAO').map((s) => s.id)).toEqual(['s1']);
    expect(filterSkills(list, 'báo').map((s) => s.id)).toEqual(['s1']);
    expect(filterSkills(list, 'git').map((s) => s.id)).toEqual(['s2']);
    expect(filterSkills(list, '  ')).toHaveLength(2);
  });

  it('toggles ids and detects the limit', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(atSkillLimit(29)).toBe(false);
    expect(atSkillLimit(30)).toBe(true);
  });

  it('reads the agent names of an IN_USE error', () => {
    expect(inUseAgents({ agents: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(inUseAgents({ agents: 'x' })).toEqual([]);
    expect(inUseAgents(undefined)).toEqual([]);
  });
});

describe('form', () => {
  it('validates required fields and lengths', () => {
    const ok = { name: 'A', description: 'd', content: 'c' };
    expect(validateSkillForm(translate, ok)).toEqual({});
    expect(validateSkillForm(translate, { name: ' ', description: '', content: '' })).toMatchObject(
      {
        name: expect.any(String),
        description: expect.any(String),
        content: expect.any(String),
      },
    );
    expect(validateSkillForm(translate, { ...ok, name: 'x'.repeat(81) }).name).toBeTruthy();
    expect(
      validateSkillForm(translate, { ...ok, description: 'x'.repeat(501) }).description,
    ).toBeTruthy();
  });

  it('is dirty when a trimmed field differs', () => {
    const s = { name: 'A', description: 'd', content: 'c' };
    expect(isSkillDirty(s, { ...s, name: ' A ' })).toBe(false);
    expect(isSkillDirty(s, { ...s, content: 'c2' })).toBe(true);
  });

  it('normalizes whitespace in the name on both sides, like the server', () => {
    const s = { name: 'Báo giá', description: 'd', content: 'c' };
    expect(isSkillDirty(s, { ...s, name: '  Báo   giá ' })).toBe(false);
    expect(isSkillDirty({ ...s, name: 'Báo  giá' }, s)).toBe(false);
    expect(isSkillDirty(s, { ...s, name: 'Báo giá 2' })).toBe(true);
    expect(normalizeSkillName(' a \t b\n c ')).toBe('a b c');
  });
});

describe('approval', () => {
  it('only an owner or admin can approve', () => {
    expect(canApproveSkill({ role: 'owner' })).toBe(true);
    expect(canApproveSkill({ role: 'admin' })).toBe(true);
    expect(canApproveSkill({ role: 'member' })).toBe(false);
    expect(canApproveSkill(undefined)).toBe(false);
  });

  it('flags untrusted skills', () => {
    const a = skill({ id: 'a', trusted: true });
    const b = skill({ id: 'b', trusted: false });
    expect(needsApproval(a)).toBe(false);
    expect(needsApproval(b)).toBe(true);
    expect([...unapprovedIds([a, b])]).toEqual(['b']);
  });
});
