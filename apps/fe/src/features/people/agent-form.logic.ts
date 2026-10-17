import type { AgentSkill, CreateAgentInput, MemberRole } from '@repo/shared';

export const MAX_NAME = 60;
export const MAX_TURNS = 200;
export const DEFAULT_MAX_TURNS = 40;

/** What the API allows: only an owner or an admin manages agents. */
export const canManageAgents = (role: MemberRole | undefined): boolean =>
  role === 'owner' || role === 'admin';

export const MANAGER_ONLY_HINT = 'Chỉ owner/admin';

export interface AgentFormValues {
  name: string;
  computerId: string;
  /** Empty means the default persona. */
  persona: string;
  /** Empty means `~/.agent/agents/<name>`. */
  workdir: string;
  /** Raw input; parsed on submit. */
  maxTurns: string;
}

export type AgentFormErrors = Partial<
  Record<'name' | 'computerId' | 'workdir' | 'maxTurns', string>
>;

/** Whole number in 1..200, or null. */
export const parseMaxTurns = (raw: string): number | null => {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_TURNS ? value : null;
};

/**
 * `taken` are the names of the other agents (compared case-insensitively, like the API).
 * `computerIds` are the workspace's computers.
 */
export function validateAgentForm(
  values: AgentFormValues,
  taken: readonly string[],
  computerIds: readonly string[],
  options: { requireWorkdir?: boolean } = {},
): AgentFormErrors {
  const errors: AgentFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Nhập tên agent';
  else if (name.length > MAX_NAME) errors.name = `Tên tối đa ${MAX_NAME} ký tự`;
  else if (taken.some((t) => t.trim().toLowerCase() === name.toLowerCase()))
    errors.name = 'Đã có agent trùng tên';
  if (!computerIds.includes(values.computerId)) errors.computerId = 'Chọn computer';
  if (options.requireWorkdir && !values.workdir.trim()) errors.workdir = 'Nhập workdir';
  if (values.maxTurns.trim() && parseMaxTurns(values.maxTurns) === null)
    errors.maxTurns = `Số nguyên từ 1 đến ${MAX_TURNS}`;
  return errors;
}

/** Skills as the API takes them: the checked ones on, the rest off. */
export const skillFlags = (
  catalog: readonly AgentSkill[],
  enabled: ReadonlySet<string>,
): Pick<AgentSkill, 'id' | 'enabled'>[] =>
  catalog.map((s) => ({ id: s.id, enabled: enabled.has(s.id) }));

/** Empty optional fields are left out so the API applies its defaults. */
export function toCreateInput(
  values: AgentFormValues,
  skills: Pick<AgentSkill, 'id' | 'enabled'>[] | undefined,
): CreateAgentInput {
  const persona = values.persona.trim() ? values.persona : undefined;
  const workdir = values.workdir.trim() || undefined;
  const maxTurns = parseMaxTurns(values.maxTurns) ?? undefined;
  return {
    name: values.name.trim(),
    computerId: values.computerId,
    ...(persona ? { persona } : null),
    ...(skills ? { skills } : null),
    ...(workdir ? { workdir } : null),
    ...(maxTurns ? { maxTurns } : null),
  };
}

/** The agent to open after `removedId` is gone: the first remaining one. */
export const nextAgentAfterDelete = (
  agents: readonly { id: string }[],
  removedId: string,
): string | null => agents.find((a) => a.id !== removedId)?.id ?? null;
