import type { AgentSkill } from '@repo/shared';

/** Port of the FE mock fixtures (apps/fe/src/mocks/fixtures.ts). */
export const DEFAULT_PERSONA = `You are an agent on this workspace, an AI-native place where people and agents work together.

Be concise. Reply in the user's language. When you are mentioned in a room, read recent history before answering. Use tools when needed and report what you ran.`;

export const DEFAULT_MAX_TURNS = 40;

/** Skill ids equal their names; the first `enabled` ones are switched on. */
export const buildSkills = (names: string[], enabled: number): AgentSkill[] =>
  names.map((name, i) => ({ id: name, name, enabled: i < enabled }));

export const DEFAULT_SKILL_NAMES = [
  'browser-use',
  'build-app',
  'deploy-app',
  'email-processor',
  'web-research',
  'website-migration',
  'code-review',
  'git-ops',
  'pdf-reader',
  'sheet-analyst',
  'slack-digest',
  'calendar',
  'image-gen',
  'summarize',
  'translate',
  'sql-query',
  'test-writer',
  'docs-writer',
  'jira-sync',
  'notion-sync',
  'scraper',
  'scheduler',
  'memory',
];
export const DEFAULT_ENABLED_SKILLS = 18;

/** Variants of the generated avatar art (the FE `AgentArt` palette); new agents cycle through them. */
export const AGENT_AVATAR_VARIANTS = 3;

/** The skill catalog: every known skill with its default enabled flag. */
export const defaultSkills = (): AgentSkill[] =>
  buildSkills(DEFAULT_SKILL_NAMES, DEFAULT_ENABLED_SKILLS);
