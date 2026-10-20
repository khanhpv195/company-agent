import { Logger } from '@nestjs/common';
import { skillTemplateById } from '@repo/shared';
import { IsNull, Not, type DataSource } from 'typeorm';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { SkillVersion } from '../../modules/skills/entities/skill-version.entity';
import { Skill } from '../../modules/skills/entities/skill.entity';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const OWNER_EMAIL = 'khanhpv@holatech.tech';

/** Skill templates (ids = slugs) the demo workspace starts with, and who has them on. */
const LIBRARY = [
  'tom-tat',
  'dich',
  'nghien-cuu-web',
  'viet-bai',
  'tra-loi-khach',
  'bao-gia',
  'review-code',
  'viet-test',
  'git',
];

const AGENT_SKILLS: Record<string, string[]> = {
  "khanhpv's Claude": ['tom-tat', 'dich', 'viet-bai', 'tra-loi-khach', 'bao-gia'],
  'Research Bot': ['nghien-cuu-web', 'tom-tat', 'dich'],
  Deployer: ['git', 'review-code', 'viet-test'],
};

/**
 * The library of the `khanhpv` workspace, built from the skill templates, and the skills the seed
 * agents have on. Idempotent, and like the departments seed it runs on every dev start: once the
 * workspace has had skills they belong to the users, so nothing is recreated or re-enabled.
 */
export const seedSkills = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:skills');
  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    const workspaceId = workspace.id;
    // Only template skills count (soft-deleted ones too): a dev DB that has just the placeholders
    // migrated from the legacy skill ids still gets the template skills.
    if (
      await manager.exists(Skill, {
        where: { workspaceId, templateId: Not(IsNull()) },
        withDeleted: true,
      })
    ) {
      return;
    }
    const owner = await manager.findOne(Member, { where: { workspaceId, email: OWNER_EMAIL } });

    const ids = new Map<string, string>();
    for (const templateId of LIBRARY) {
      const template = skillTemplateById(templateId);
      if (!template) {
        logger.warn(`Skill template ${templateId} not found, skipped`);
        continue;
      }
      // A live skill with this slug (a migrated placeholder) keeps its place; the agents use it.
      const existing = await manager.findOne(Skill, {
        where: { workspaceId, slug: template.slug },
      });
      if (existing) {
        ids.set(template.id, existing.id);
        continue;
      }
      const skill = await manager.save(
        manager.create(Skill, {
          workspaceId,
          slug: template.slug,
          name: template.name,
          description: template.description,
          content: template.content,
          templateId: template.id,
          version: 1,
          createdByMemberId: owner?.id ?? null,
          updatedByMemberId: owner?.id ?? null,
        }),
      );
      await manager.insert(SkillVersion, {
        skillId: skill.id,
        version: 1,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        editedByMemberId: owner?.id ?? null,
      });
      ids.set(template.id, skill.id);
      logger.log(`Created skill ${template.slug}`);
    }

    for (const [name, wanted] of Object.entries(AGENT_SKILLS)) {
      const agent = await manager.findOne(Agent, { where: { workspaceId, name } });
      if (!agent) continue;
      const skills = wanted.flatMap((templateId) => ids.get(templateId) ?? []);
      await manager.update(Agent, { id: agent.id }, { skills });
    }
  });
};
