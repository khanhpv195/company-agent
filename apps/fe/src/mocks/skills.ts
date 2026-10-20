import {
  MAX_AGENT_SKILLS,
  MAX_AGENT_SKILL_CONTENT,
  MAX_SKILL_CONTENT,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  skillTemplateById,
  type Agent,
  type CreateSkillInput,
  type Member,
  type Skill,
  type SkillVersion,
  type UpdateSkillInput,
} from '@repo/shared';
import {
  canEditSkill,
  canSetAgentSkills,
  slugifySkill,
  SLUG_PATTERN,
} from '../features/skills/skills.logic';
import { HttpError, type MockBackend } from './backend';
import { iso } from './fixtures';

const me = (b: MockBackend): Member => b.db.members.find((m) => m.id === b.db.meId)!;

const view = (b: MockBackend, s: Skill): Skill => ({
  ...s,
  agentIds: b.db.agents
    .filter((a) => a.skills.some((x) => x.id === s.id && x.enabled))
    .map((a) => a.id),
});

export const skillOr404 = (b: MockBackend, id: string): Skill => {
  const s = b.db.skills.find((x) => x.id === id);
  if (!s) throw new HttpError(404, 'Không tìm thấy skill');
  return s;
};

export const listSkills = (b: MockBackend): Skill[] =>
  [...b.db.skills].sort((x, y) => x.name.localeCompare(y.name)).map((s) => view(b, s));

export const getSkill = (b: MockBackend, id: string): Skill => view(b, skillOr404(b, id));

export const skillVersions = (b: MockBackend, id: string): SkillVersion[] => {
  skillOr404(b, id);
  return b.db.skillVersions[id] ?? [];
};

/**
 * Rebuilds every agent's skill list from the library: all skills sorted by name, with the
 * flags the agent had (a skill that is gone drops out, a new one starts off).
 */
export function rebuildAgentSkills(b: MockBackend): void {
  const library = [...b.db.skills].sort((x, y) => x.name.localeCompare(y.name));
  for (const a of b.db.agents) {
    const on = new Set(a.skills.filter((x) => x.enabled).map((x) => x.id));
    a.skills = library.map((s) => ({ id: s.id, name: s.name, enabled: on.has(s.id) }));
  }
}

/** Every id is a live skill, within the per-agent count and size limits. */
export function assertSkillIds(b: MockBackend, ids: readonly string[]): void {
  const unique = [...new Set(ids)];
  // Same order as the API: the count first, then the ids, then the total size.
  if (unique.length > MAX_AGENT_SKILLS)
    throw new HttpError(400, `Mỗi agent tối đa ${MAX_AGENT_SKILLS} skill`);
  const skills = unique.map((id) => skillOr404(b, id));
  if (skills.reduce((n, s) => n + s.content.length, 0) > MAX_AGENT_SKILL_CONTENT)
    throw new HttpError(400, 'Các skill của agent quá dài');
}

/**
 * A skill that grows must not push an agent that has it on past the total size limit
 * (400, naming the agents like the API's `skills.TOO_LARGE`).
 */
function assertAgentsFit(b: MockBackend, skill: Skill, newLength: number): void {
  const tooLarge = b.db.agents
    .filter((a) => a.skills.some((x) => x.id === skill.id && x.enabled))
    .filter((a) => {
      const total = a.skills
        .filter((x) => x.enabled)
        .reduce(
          (n, x) =>
            n +
            (x.id === skill.id
              ? newLength
              : (b.db.skills.find((s) => s.id === x.id)?.content.length ?? 0)),
          0,
        );
      return total > MAX_AGENT_SKILL_CONTENT;
    })
    .map((a) => a.name)
    .sort((x, y) => x.localeCompare(y));
  if (tooLarge.length)
    throw new HttpError(400, 'Các skill của agent quá dài', { agents: tooLarge });
}

const changed = (b: MockBackend) => {
  rebuildAgentSkills(b);
  b.emit({ type: 'skills.changed' });
  b.emit({ type: 'agents.changed' });
};

const text = (v: unknown, max: number, label: string, collapse = false): string => {
  let out = typeof v === 'string' ? v.trim() : '';
  if (collapse) out = out.replace(/\s+/g, ' ');
  if (!out || out.length > max) throw new HttpError(400, `${label} cần từ 1 đến ${max} ký tự`);
  return out;
};

const content = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'Nội dung không được để trống');
  if (v.length > MAX_SKILL_CONTENT)
    throw new HttpError(400, `Nội dung tối đa ${MAX_SKILL_CONTENT} ký tự`);
  return v;
};

function uniqueSlug(b: MockBackend, base: string): string {
  const taken = new Set(b.db.skills.map((s) => s.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 60)}-${n}`;
  return slug;
}

export function createSkill(b: MockBackend, input: Partial<CreateSkillInput>): Skill {
  const tpl = input.templateId ? skillTemplateById(input.templateId) : undefined;
  if (input.templateId && !tpl) throw new HttpError(400, 'Mẫu skill không tồn tại');
  const name = text(input.name ?? tpl?.name, MAX_SKILL_NAME, 'Tên', true);
  const description = text(input.description ?? tpl?.description, MAX_SKILL_DESCRIPTION, 'Mô tả');
  const body = content(input.content ?? tpl?.content);
  let slug: string;
  if (input.slug !== undefined) {
    if (!SLUG_PATTERN.test(input.slug)) throw new HttpError(400, 'Slug không hợp lệ');
    if (b.db.skills.some((s) => s.slug === input.slug))
      throw new HttpError(409, 'Slug này đã được dùng');
    slug = input.slug;
  } else {
    slug = uniqueSlug(b, slugifySkill(name) || 'skill');
  }
  const now = iso(b.now());
  const skill: Skill = {
    id: b.nextId('sk'),
    slug,
    name,
    description,
    content: body,
    templateId: tpl?.id ?? null,
    version: 1,
    createdById: b.db.meId,
    updatedById: b.db.meId,
    updatedAt: now,
    agentIds: [],
  };
  b.db.skills.push(skill);
  b.db.skillVersions[skill.id] = [
    { version: 1, name, description, content: body, editedById: b.db.meId, createdAt: now },
  ];
  changed(b);
  return view(b, skill);
}

function assertCanEdit(b: MockBackend, skill: Skill) {
  if (!canEditSkill(skill, me(b)))
    throw new HttpError(403, 'Chỉ người tạo, chủ sở hữu hoặc quản trị viên được sửa skill này');
}

function newVersion(b: MockBackend, skill: Skill, next: UpdateSkillInput & { content: string }) {
  skill.name = next.name ?? skill.name;
  skill.description = next.description ?? skill.description;
  skill.content = next.content;
  skill.version += 1;
  skill.updatedById = b.db.meId;
  skill.updatedAt = iso(b.now());
  (b.db.skillVersions[skill.id] ??= []).unshift({
    version: skill.version,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    editedById: b.db.meId,
    createdAt: skill.updatedAt,
  });
}

export function updateSkill(b: MockBackend, id: string, patch: UpdateSkillInput): Skill {
  const skill = skillOr404(b, id);
  assertCanEdit(b, skill);
  const name =
    patch.name === undefined ? skill.name : text(patch.name, MAX_SKILL_NAME, 'Tên', true);
  const description =
    patch.description === undefined
      ? skill.description
      : text(patch.description, MAX_SKILL_DESCRIPTION, 'Mô tả');
  const body = patch.content === undefined ? skill.content : content(patch.content);
  if (name !== skill.name || description !== skill.description || body !== skill.content) {
    assertAgentsFit(b, skill, body.length);
    newVersion(b, skill, { name, description, content: body });
    changed(b);
  }
  return view(b, skill);
}

export function restoreSkill(b: MockBackend, id: string, version: unknown): Skill {
  const skill = skillOr404(b, id);
  assertCanEdit(b, skill);
  const old = skillVersions(b, id).find((v) => v.version === version);
  if (!old) throw new HttpError(404, 'Không tìm thấy phiên bản');
  assertAgentsFit(b, skill, old.content.length);
  newVersion(b, skill, { name: old.name, description: old.description, content: old.content });
  changed(b);
  return view(b, skill);
}

export function deleteSkill(b: MockBackend, id: string): void {
  const skill = skillOr404(b, id);
  assertCanEdit(b, skill);
  const using = view(b, skill)
    .agentIds.map((x) => b.agent(x)?.name)
    .filter((n): n is string => !!n);
  if (using.length) throw new HttpError(409, 'Skill đang được agent dùng', { agents: using });
  b.db.skills = b.db.skills.filter((s) => s.id !== id);
  delete b.db.skillVersions[id];
  changed(b);
}

export function setAgentSkills(b: MockBackend, agent: Agent, skillIds: unknown): Agent {
  if (!canSetAgentSkills(me(b), agent))
    throw new HttpError(403, 'Bạn không được đổi skill của agent này');
  if (!Array.isArray(skillIds) || skillIds.some((x) => typeof x !== 'string'))
    throw new HttpError(400, 'Danh sách skill không hợp lệ');
  assertSkillIds(b, skillIds as string[]);
  agent.skills = (skillIds as string[]).map((id) => ({ id, name: '', enabled: true }));
  changed(b);
  return agent;
}
