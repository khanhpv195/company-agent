/** A skill of the workspace library: a SKILL.md that agents on a computer can use. */
export interface Skill {
  id: string;
  /** `[a-z0-9-]`, 1..64, unique among the live skills of the workspace. */
  slug: string;
  /** 1..80 characters. */
  name: string;
  /** 1..500 characters; tells Claude when to use the skill. */
  description: string;
  /** SKILL.md body (markdown), at most `MAX_SKILL_CONTENT` characters. */
  content: string;
  /** The catalog template it was created from (statistics only). */
  templateId: string | null;
  /** Starts at 1, +1 on every name, description or content change. */
  version: number;
  createdById: string | null;
  updatedById: string | null;
  updatedAt: string;
  /**
   * False when the last editor is a member who is not an owner or admin (any more, or removed):
   * agents using the skill cannot use admin tools until an owner or admin approves it.
   */
  trusted: boolean;
  /** Live agents that have it enabled. */
  agentIds: string[];
}

export interface SkillVersion {
  version: number;
  name: string;
  description: string;
  content: string;
  editedById: string | null;
  createdAt: string;
}

export interface CreateSkillInput {
  /** Defaults to the slug of the name. */
  slug?: string;
  name: string;
  description: string;
  content: string;
  /** A template id; the fields left out default to the template's. */
  templateId?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  content?: string;
}

export interface RestoreSkillInput {
  version: number;
}

/** The full set of skills enabled on the agent. */
export interface SetAgentSkillsInput {
  skillIds: string[];
}

export const MAX_SKILL_CONTENT = 20_000;
export const MAX_SKILL_NAME = 80;
export const MAX_SKILL_DESCRIPTION = 500;
export const MAX_SKILL_SLUG = 64;
export const MAX_AGENT_SKILLS = 30;
export const MAX_AGENT_SKILL_CONTENT = 200_000;
