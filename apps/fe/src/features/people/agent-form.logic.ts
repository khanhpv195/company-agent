import type { AgentSkill, CreateAgentInput, MemberRole } from '@repo/shared';
import type { MessageKey, TFunction } from '../../i18n';

export const MAX_NAME = 60;
export const MAX_TURNS = 200;
export const DEFAULT_MAX_TURNS = 40;

/** What the API allows: only an owner or an admin manages agents. */
export const canManageAgents = (role: MemberRole | undefined): boolean =>
  role === 'owner' || role === 'admin';

export const MANAGER_ONLY_HINT: MessageKey = 'people.managerOnly';

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
 * `computerIds` are the workspace's computers. `t` localizes the messages.
 */
export function validateAgentForm(
  t: TFunction,
  values: AgentFormValues,
  taken: readonly string[],
  computerIds: readonly string[],
  options: { requireWorkdir?: boolean } = {},
): AgentFormErrors {
  const errors: AgentFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = t('people.form.nameRequired');
  else if (name.length > MAX_NAME) errors.name = t('people.form.nameTooLong', { max: MAX_NAME });
  else if (taken.some((x) => x.trim().toLowerCase() === name.toLowerCase()))
    errors.name = t('people.form.nameTaken');
  if (!computerIds.includes(values.computerId)) errors.computerId = t('people.form.chooseComputer');
  if (options.requireWorkdir && !values.workdir.trim())
    errors.workdir = t('people.form.workdirRequired');
  if (values.maxTurns.trim() && parseMaxTurns(values.maxTurns) === null)
    errors.maxTurns = t('people.form.maxTurnsInvalid', { max: MAX_TURNS });
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
