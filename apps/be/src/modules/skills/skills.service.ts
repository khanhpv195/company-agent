import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  MAX_SKILL_SLUG,
  skillTemplateById,
  type Skill as SkillContract,
  type SkillVersion as SkillVersionContract,
} from '@repo/shared';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import type { AuthContext } from '../../common/types';
import { Agent } from '../agents/entities/agent.entity';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { slugify } from '../workspace/slug.util';
import { CreateSkillDto, RestoreSkillDto, UpdateSkillDto } from './dto/skill.dto';
import { SkillVersion } from './entities/skill-version.entity';
import { Skill } from './entities/skill.entity';
import { findLiveSkill } from './skill-access';

const PG_UNIQUE_VIOLATION = '23505';
const SLUG_UNIQUE_INDEX = 'UQ_skills_workspace_slug_live';
/** Used when a skill name has no ascii letter or digit left (e.g. only symbols). */
const SLUG_FALLBACK = 'skill';

const toSkill = (row: Skill, agentIds: string[]): SkillContract => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  content: row.content,
  templateId: row.templateId,
  version: row.version,
  createdById: row.createdByMemberId,
  updatedById: row.updatedByMemberId,
  updatedAt: row.updatedAt.toISOString(),
  agentIds,
});

const toVersion = (row: SkillVersion): SkillVersionContract => ({
  version: row.version,
  name: row.name,
  description: row.description,
  content: row.content,
  editedById: row.editedByMemberId,
  createdAt: row.createdAt.toISOString(),
});

/** `base`, `base-2`, `base-3`... each at most `MAX_SKILL_SLUG` characters long. */
const slugCandidate = (base: string, n: number): string => {
  if (n === 1) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, MAX_SKILL_SLUG - suffix.length).replace(/-+$/, '')}${suffix}`;
};

/**
 * The workspace skill library. Every write runs under the workspace lock (the same one agent
 * commands take), so "delete a skill" and "enable it on an agent" never interleave; it audits in
 * the transaction and publishes `skills.changed` only after the commit.
 */
@Injectable()
export class SkillsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lock: WorkspaceLockService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string): Promise<SkillContract[]> {
    const manager = this.dataSource.manager;
    const rows = await manager.find(Skill, {
      where: { workspaceId },
      order: { name: 'ASC', id: 'ASC' },
    });
    const usage = await this.usage(manager, workspaceId);
    return rows.map((row) => toSkill(row, usage.get(row.id) ?? []));
  }

  async get(workspaceId: string, id: string): Promise<SkillContract> {
    const manager = this.dataSource.manager;
    const row = await findLiveSkill(manager, workspaceId, id);
    const usage = await this.usage(manager, workspaceId);
    return toSkill(row, usage.get(row.id) ?? []);
  }

  /** Newest first. */
  async versions(workspaceId: string, id: string): Promise<SkillVersionContract[]> {
    const manager = this.dataSource.manager;
    const row = await findLiveSkill(manager, workspaceId, id);
    const versions = await manager.find(SkillVersion, {
      where: { skillId: row.id },
      order: { version: 'DESC' },
    });
    return versions.map(toVersion);
  }

  /** Any member may add to the library; they become its creator. */
  create(auth: AuthContext, dto: CreateSkillDto): Promise<SkillContract> {
    return this.slugged(() =>
      this.lock.run(auth.workspaceId, async (manager, effects) => {
        const template = dto.templateId ? skillTemplateById(dto.templateId) : undefined;
        if (dto.templateId && !template) {
          throw new BadRequestException({ message: 'skills.UNKNOWN_TEMPLATE' });
        }
        const name = dto.name ?? template?.name;
        const description = dto.description ?? template?.description;
        const content = dto.content ?? template?.content;
        if (name === undefined || description === undefined || content === undefined) {
          // The DTO requires them without a template; this keeps the types honest.
          throw new BadRequestException({ message: 'common.errors.VALIDATION_FAILED' });
        }
        const slug = await this.freeSlug(
          manager,
          auth.workspaceId,
          dto.slug ?? null,
          slugify(dto.name ?? template?.slug ?? name, SLUG_FALLBACK)
            .slice(0, MAX_SKILL_SLUG)
            .replace(/-+$/, ''),
        );
        const row = await manager.save(
          manager.create(Skill, {
            workspaceId: auth.workspaceId,
            slug,
            name,
            description,
            content,
            templateId: template?.id ?? null,
            version: 1,
            createdByMemberId: auth.memberId,
            updatedByMemberId: auth.memberId,
          }),
        );
        await this.writeVersion(manager, row, auth.memberId);
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'skill.created',
            targetType: 'skill',
            targetId: row.id,
            meta: { slug: row.slug, name: row.name, templateId: row.templateId },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => this.publish(auth.workspaceId));
        return toSkill(row, []);
      }),
    );
  }

  /** Creator, owner or admin. A change of name, description or content makes a new version. */
  update(auth: AuthContext, id: string, dto: UpdateSkillDto): Promise<SkillContract> {
    return this.lock.run(auth.workspaceId, async (manager, effects) => {
      const row = await findLiveSkill(manager, auth.workspaceId, id);
      this.assertCanEdit(auth, row);
      const changes: Partial<Pick<Skill, 'name' | 'description' | 'content'>> = {};
      for (const key of ['name', 'description', 'content'] as const) {
        if (dto[key] !== undefined && dto[key] !== row[key]) changes[key] = dto[key];
      }
      const agentIds = (await this.usage(manager, auth.workspaceId, row.id)).get(row.id) ?? [];
      if (Object.keys(changes).length > 0) {
        const from = row.version;
        Object.assign(row, changes, { version: row.version + 1, updatedByMemberId: auth.memberId });
        await manager.save(row);
        await this.writeVersion(manager, row, auth.memberId);
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'skill.updated',
            targetType: 'skill',
            targetId: row.id,
            meta: {
              slug: row.slug,
              from,
              to: row.version,
              fields: Object.keys(changes),
              agents: agentIds.length,
            },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => this.publishChange(auth.workspaceId, agentIds.length > 0));
      }
      return toSkill(row, agentIds);
    });
  }

  /** Copies an older version into a new one (history is never rewritten). Creator, owner, admin. */
  restore(auth: AuthContext, id: string, dto: RestoreSkillDto): Promise<SkillContract> {
    return this.lock.run(auth.workspaceId, async (manager, effects) => {
      const row = await findLiveSkill(manager, auth.workspaceId, id);
      this.assertCanEdit(auth, row);
      const old = await manager.findOne(SkillVersion, {
        where: { skillId: row.id, version: dto.version },
      });
      if (!old) throw new NotFoundException({ message: 'skills.VERSION_NOT_FOUND' });
      const from = row.version;
      Object.assign(row, {
        name: old.name,
        description: old.description,
        content: old.content,
        version: row.version + 1,
        updatedByMemberId: auth.memberId,
      });
      await manager.save(row);
      await this.writeVersion(manager, row, auth.memberId);
      const agentIds = (await this.usage(manager, auth.workspaceId, row.id)).get(row.id) ?? [];
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'skill.restored',
          targetType: 'skill',
          targetId: row.id,
          meta: {
            slug: row.slug,
            restored: dto.version,
            from,
            to: row.version,
            agents: agentIds.length,
          },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.publishChange(auth.workspaceId, agentIds.length > 0));
      return toSkill(row, agentIds);
    });
  }

  /** Soft delete; 409 `skills.IN_USE` (with the agent names) while a live agent has it on. */
  async remove(auth: AuthContext, id: string): Promise<null> {
    await this.lock.run(auth.workspaceId, async (manager, effects) => {
      const row = await findLiveSkill(manager, auth.workspaceId, id);
      this.assertCanEdit(auth, row);
      const users = await manager
        .createQueryBuilder(Agent, 'a')
        .select(['a.id', 'a.name'])
        .where('a.workspace_id = :workspaceId', { workspaceId: auth.workspaceId })
        .andWhere('a.skills @> :needle::jsonb', { needle: JSON.stringify([row.id]) })
        .orderBy('a.name', 'ASC')
        .getMany();
      if (users.length) {
        throw new ConflictException({
          message: 'skills.IN_USE',
          details: { agents: users.map((agent) => agent.name) },
        });
      }
      await manager.softDelete(Skill, { id: row.id });
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'skill.deleted',
          targetType: 'skill',
          targetId: row.id,
          meta: { slug: row.slug, name: row.name },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.publish(auth.workspaceId));
    });
    return null;
  }

  // ---------- internals ----------

  private publish(workspaceId: string): void {
    this.events.publish(workspaceId, { type: 'skills.changed' });
  }

  /** An edit also changes what the agents that have the skill on will run. */
  private publishChange(workspaceId: string, usedByAgents: boolean): void {
    this.publish(workspaceId);
    if (usedByAgents) this.events.publish(workspaceId, { type: 'agents.changed' });
  }

  private assertCanEdit(auth: AuthContext, skill: Skill): void {
    if (auth.role === 'owner' || auth.role === 'admin') return;
    if (skill.createdByMemberId === auth.memberId) return;
    throw new ForbiddenException({ message: 'skills.FORBIDDEN' });
  }

  private async writeVersion(
    manager: EntityManager,
    skill: Skill,
    editorMemberId: string,
  ): Promise<void> {
    await manager.insert(SkillVersion, {
      skillId: skill.id,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      editedByMemberId: editorMemberId,
    });
  }

  /** Live agents that have each skill on (one query; optionally only the agents with `skillId`). */
  private async usage(
    manager: EntityManager,
    workspaceId: string,
    skillId?: string,
  ): Promise<Map<string, string[]>> {
    const query = manager
      .createQueryBuilder(Agent, 'a')
      .select(['a.id', 'a.skills'])
      .where('a.workspace_id = :workspaceId', { workspaceId })
      .orderBy('a.created_at', 'ASC')
      .addOrderBy('a.id', 'ASC');
    if (skillId)
      query.andWhere('a.skills @> :needle::jsonb', { needle: JSON.stringify([skillId]) });
    const usage = new Map<string, string[]>();
    for (const agent of await query.getMany()) {
      for (const id of agent.skills) usage.set(id, [...(usage.get(id) ?? []), agent.id]);
    }
    return usage;
  }

  /**
   * A given slug must be free (409); a derived one gets `-2`, `-3`... Runs under the lock, so a
   * free slug stays free until the insert.
   */
  private async freeSlug(
    manager: EntityManager,
    workspaceId: string,
    given: string | null,
    derived: string,
  ): Promise<string> {
    const base = given ?? derived;
    const rows: { slug: string }[] = await manager.query(
      `SELECT slug FROM skills
       WHERE workspace_id = $1 AND deleted_at IS NULL AND (slug = $2 OR slug LIKE $2 || '-%')`,
      [workspaceId, base],
    );
    const taken = new Set(rows.map((row) => row.slug));
    if (given !== null) {
      if (taken.has(given)) throw new ConflictException({ message: 'skills.SLUG_TAKEN' });
      return given;
    }
    for (let n = 1; ; n++) {
      const candidate = slugCandidate(base, n);
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** A unique violation on the slug (a race past `freeSlug`) is a 409, not a 500. */
  private async slugged<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION &&
        (error.driverError as { constraint?: string }).constraint === SLUG_UNIQUE_INDEX
      ) {
        throw new ConflictException({ message: 'skills.SLUG_TAKEN' });
      }
      throw error;
    }
  }
}
