import {
  MAX_AGENT_SKILLS,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  MAX_SKILL_SLUG,
  type Agent,
  type MemberRole,
  type Skill,
} from '@repo/shared';
import type { TFunction } from '../../i18n';

/** `Báo giá` -> `bao-gia`; the same rule as the API's default slug. */
export const slugifySkill = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_SLUG)
    .replace(/-+$/g, '');

export const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

const isManager = (role: MemberRole | undefined) => role === 'owner' || role === 'admin';

/** Edit, restore and delete: the creator, an owner or an admin (like the API). */
export const canEditSkill = (
  skill: Pick<Skill, 'createdById'>,
  me: { id: string; role: MemberRole } | undefined,
): boolean => !!me && (isManager(me.role) || (!!skill.createdById && skill.createdById === me.id));

/** Owner/admin for any agent; a member only for an agent of their own department. */
export const canSetAgentSkills = (
  me: { role: MemberRole; departmentId: string | null } | undefined,
  agent: Pick<Agent, 'departmentId'>,
): boolean =>
  !!me &&
  (isManager(me.role) || (me.departmentId !== null && me.departmentId === agent.departmentId));

/** Case- and diacritics-insensitive match on name or slug; empty matches all. */
export function filterSkills(skills: readonly Skill[], query: string): Skill[] {
  const fold = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...skills];
  return skills.filter((s) => fold(s.name).includes(q) || s.slug.includes(q));
}

/** Library order: by name. */
export const sortSkills = (skills: readonly Skill[]): Skill[] =>
  [...skills].sort((a, b) => a.name.localeCompare(b.name));

export interface SkillFormValues {
  name: string;
  description: string;
  content: string;
}
export type SkillFormErrors = Partial<Record<keyof SkillFormValues, string>>;

export function validateSkillForm(t: TFunction, values: SkillFormValues): SkillFormErrors {
  const errors: SkillFormErrors = {};
  const name = values.name.trim();
  const description = values.description.trim();
  if (!name) errors.name = t('skills.form.nameRequired');
  else if (name.length > MAX_SKILL_NAME)
    errors.name = t('skills.form.nameTooLong', { max: MAX_SKILL_NAME });
  if (!description) errors.description = t('skills.form.descriptionRequired');
  else if (description.length > MAX_SKILL_DESCRIPTION)
    errors.description = t('skills.form.descriptionTooLong', { max: MAX_SKILL_DESCRIPTION });
  if (!values.content.trim()) errors.content = t('skills.form.contentRequired');
  return errors;
}

/** Whether the form differs from the saved skill (trimmed name and description). */
export const isSkillDirty = (skill: SkillFormValues, values: SkillFormValues): boolean =>
  skill.name !== values.name.trim() ||
  skill.description !== values.description.trim() ||
  skill.content !== values.content;

/** `[agent names]` from a `skills.IN_USE` error's `meta.details.agents`; empty when absent. */
export function inUseAgents(details: unknown): string[] {
  const agents = (details as { agents?: unknown } | null | undefined)?.agents;
  return Array.isArray(agents) ? agents.filter((a): a is string => typeof a === 'string') : [];
}

/** The enabled ids with `id` switched on or off. */
export function toggleId(enabled: readonly string[], id: string): string[] {
  return enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id];
}

/** True when switching one more skill on would pass the per-agent limit. */
export const atSkillLimit = (enabledCount: number): boolean => enabledCount >= MAX_AGENT_SKILLS;

/** Ids of the skills an agent has switched on. */
export const enabledIdsOf = (agent: Pick<Agent, 'skills'>): string[] =>
  agent.skills.filter((s) => s.enabled).map((s) => s.id);
