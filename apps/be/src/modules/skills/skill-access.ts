import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MAX_AGENT_SKILL_CONTENT, MAX_AGENT_SKILLS } from '@repo/shared';
import { isUUID } from 'class-validator';
import { In, type EntityManager } from 'typeorm';
import { Skill } from './entities/skill.entity';

/** What the agent mapper and the gateway tools need to know about a library skill. */
export interface SkillRef {
  id: string;
  slug: string;
  name: string;
}

/** A skill as the daemon installs it (the gateway payload `skillDefs`). */
export interface GatewaySkillDef {
  slug: string;
  name: string;
  description: string;
  content: string;
  version: number;
}

const byName = (a: SkillRef, b: SkillRef): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id);

/** Every live skill of the workspace, sorted by name: one query serves a whole request. */
export const loadLibrary = async (
  manager: EntityManager,
  workspaceId: string,
): Promise<SkillRef[]> => {
  const rows = await manager.find(Skill, {
    where: { workspaceId },
    select: { id: true, slug: true, name: true },
  });
  return rows.map(({ id, slug, name }) => ({ id, slug, name })).sort(byName);
};

/** A live skill of the workspace; foreign, deleted or malformed ids are a 404. */
export const findLiveSkill = async (
  manager: EntityManager,
  workspaceId: string,
  id: string,
): Promise<Skill> => {
  const skill = isUUID(id) ? await manager.findOne(Skill, { where: { id, workspaceId } }) : null;
  if (!skill) throw new NotFoundException({ message: 'skills.NOT_FOUND' });
  return skill;
};

/**
 * The skills an agent is about to have enabled: every id must be a live skill of the workspace
 * (404), at most `MAX_AGENT_SKILLS` (400) with at most `MAX_AGENT_SKILL_CONTENT` characters of
 * content in total (400). Duplicates collapse; the order is kept.
 */
export const resolveAgentSkills = async (
  manager: EntityManager,
  workspaceId: string,
  ids: readonly string[],
): Promise<Skill[]> => {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_AGENT_SKILLS) {
    throw new BadRequestException({
      message: 'skills.TOO_MANY',
      args: { max: MAX_AGENT_SKILLS },
    });
  }
  if (!unique.length) return [];
  if (unique.some((id) => !isUUID(id)))
    throw new NotFoundException({ message: 'skills.NOT_FOUND' });
  const rows = await manager.find(Skill, { where: { workspaceId, id: In(unique) } });
  if (rows.length !== unique.length) throw new NotFoundException({ message: 'skills.NOT_FOUND' });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const skills = unique.map((id) => byId.get(id)!);
  const total = skills.reduce((sum, skill) => sum + skill.content.length, 0);
  if (total > MAX_AGENT_SKILL_CONTENT) {
    throw new BadRequestException({
      message: 'skills.TOO_LARGE',
      args: { max: MAX_AGENT_SKILL_CONTENT },
    });
  }
  return skills;
};

/** The live skills among `ids`, as the daemon installs them, keyed by skill id. */
export const loadSkillDefs = async (
  manager: EntityManager,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, GatewaySkillDef & { id: string }>> => {
  const valid = [...new Set(ids)].filter((id) => isUUID(id));
  if (!valid.length) return new Map();
  const rows = await manager.find(Skill, { where: { workspaceId, id: In(valid) } });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        content: row.content,
        version: row.version,
      },
    ]),
  );
};
