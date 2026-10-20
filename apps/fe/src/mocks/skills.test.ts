import { MAX_AGENT_SKILLS, MAX_AGENT_SKILL_CONTENT } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { HttpError, MockBackend } from './backend';
import {
  approveSkill,
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  restoreSkill,
  setAgentSkills,
  skillVersions,
  updateSkill,
} from './skills';

const setup = (meId = 'u1') => {
  const b = new MockBackend({ later: () => {} });
  b.db.meId = meId;
  return b;
};

describe('mock skill library', () => {
  it('lists the seeded library with the agents using each skill', () => {
    const b = setup();
    const git = listSkills(b).find((s) => s.id === 'sk-git')!;
    expect(git.agentIds.sort()).toEqual(['a1', 'a3']);
    expect(b.agent('a1')!.skills.length).toBe(b.db.skills.length);
  });

  it('creates from a template with the server defaults and a derived slug', () => {
    const b = setup();
    const s = createSkill(b, { templateId: 'hen-lich' });
    expect(s).toMatchObject({
      slug: 'hen-lich',
      version: 1,
      templateId: 'hen-lich',
      createdById: 'u1',
    });
    expect(s.content.length).toBeGreaterThan(0);
    expect(skillVersions(b, s.id)).toHaveLength(1);
    // every agent lists it, switched off
    expect(b.agent('a2')!.skills.find((x) => x.id === s.id)).toMatchObject({ enabled: false });
    expect(() => createSkill(b, { templateId: 'nope' })).toThrow(/Mẫu/);
  });

  it('derives -2 for a derived slug clash but 409s on a given one', () => {
    const b = setup();
    const a = createSkill(b, { name: 'Báo cáo', description: 'd', content: 'c' });
    const c = createSkill(b, { name: 'Báo cáo', description: 'd', content: 'c' });
    expect([a.slug, c.slug]).toEqual(['bao-cao', 'bao-cao-2']);
    expect(() =>
      createSkill(b, { name: 'X', description: 'd', content: 'c', slug: 'bao-cao' }),
    ).toThrow(HttpError);
    expect(() =>
      createSkill(b, { name: 'X', description: 'd', content: 'c', slug: 'Bad Slug' }),
    ).toThrow(/Slug/);
  });

  it('bumps the version on a change, keeps history and restores as a new version', () => {
    const b = setup();
    const s = createSkill(b, { name: 'A', description: 'd', content: 'one' });
    expect(updateSkill(b, s.id, { content: 'one' }).version).toBe(1);
    expect(updateSkill(b, s.id, { content: 'two' }).version).toBe(2);
    const restored = restoreSkill(b, s.id, 1);
    expect(restored).toMatchObject({ version: 3, content: 'one' });
    expect(skillVersions(b, s.id).map((v) => v.version)).toEqual([3, 2, 1]);
    expect(() => restoreSkill(b, s.id, 9)).toThrow(/phiên bản/);
  });

  it('lets the creator, owner and admin edit but not another member', () => {
    const b = setup('u2'); // a member
    const mine = createSkill(b, { name: 'Mine', description: 'd', content: 'c' });
    expect(updateSkill(b, mine.id, { name: 'Mine 2' }).name).toBe('Mine 2');
    expect(() => updateSkill(b, 'sk-git', { name: 'x' })).toThrow(/Chỉ người tạo/); // made by u3
    b.db.meId = 'u3'; // admin
    expect(updateSkill(b, mine.id, { name: 'By admin' }).updatedById).toBe('u3');
    b.db.meId = 'u1'; // owner
    expect(() => deleteSkill(b, mine.id)).not.toThrow();
  });

  it('marks a member-edited skill untrusted until an owner or admin approves it', () => {
    const b = setup('u2'); // a member
    const mine = createSkill(b, { name: 'Mine', description: 'd', content: 'c' });
    expect(getSkill(b, mine.id).trusted).toBe(false);
    expect(getSkill(b, 'sk-git').trusted).toBe(true); // last saved by an admin
    expect(() => approveSkill(b, mine.id)).toThrow(/Chỉ chủ sở hữu/);
    b.db.meId = 'u3'; // admin
    const approved = approveSkill(b, mine.id);
    expect(approved).toMatchObject({ trusted: true, updatedById: 'u3', version: 1 });
    expect(skillVersions(b, mine.id)).toHaveLength(1);
    expect(approveSkill(b, mine.id).updatedById).toBe('u3'); // idempotent
    expect(() => approveSkill(b, 'nope')).toThrow(/Không tìm thấy/);
    // a member editing again makes it untrusted again
    b.db.meId = 'u2';
    updateSkill(b, mine.id, { content: 'd' });
    expect(getSkill(b, mine.id).trusted).toBe(false);
  });

  it('refuses to delete a skill in use and names the agents', () => {
    const b = setup();
    try {
      deleteSkill(b, 'sk-git');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(409);
      expect((e as HttpError).details).toEqual({
        agents: expect.arrayContaining(["khanhpv's Claude", 'Deployer']),
      });
    }
    expect(getSkill(b, 'sk-git')).toBeTruthy();
  });

  it('sets the full enabled set, scoped to owner/admin or the agent department', () => {
    const b = setup('u2'); // member of d-sales
    const a2 = b.agent('a2')!; // d-sales
    expect(
      setAgentSkills(b, a2, ['sk-dich'])
        .skills.filter((s) => s.enabled)
        .map((s) => s.id),
    ).toEqual(['sk-dich']);
    expect(() => setAgentSkills(b, b.agent('a1')!, [])).toThrow(/không được/); // d-eng
    expect(() => setAgentSkills(b, a2, ['nope'])).toThrow(/Không tìm thấy/);
    b.db.meId = 'u1';
    expect(setAgentSkills(b, b.agent('a1')!, []).skills.every((s) => !s.enabled)).toBe(true);
  });

  it('limits an agent to the maximum number of skills', () => {
    const b = setup();
    const ids = Array.from(
      { length: MAX_AGENT_SKILLS + 1 },
      (_, i) => createSkill(b, { name: `S${i}`, description: 'd', content: 'c' }).id,
    );
    expect(() => setAgentSkills(b, b.agent('a1')!, ids)).toThrow(/tối đa/);
  });

  it('checks the 30-skill limit before looking the ids up', () => {
    const b = setup();
    const ids = Array.from({ length: MAX_AGENT_SKILLS + 1 }, (_, i) => `missing-${i}`);
    expect(() => setAgentSkills(b, b.agent('a1')!, ids)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects a skill edit or restore that pushes an agent over the size limit', () => {
    const b = setup();
    const agent = b.agent('a1')!;
    const sk = b.db.skills.find((s) => s.id === 'sk-git')!;
    expect(agent.skills.find((x) => x.id === sk.id)!.enabled).toBe(true);
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as HttpError;
      }
      throw new Error('did not throw');
    };
    // The agent's other skills already hold almost the whole budget.
    for (const x of agent.skills) x.enabled = true;
    const others = b.db.skills.filter((x) => x.id !== sk.id);
    others[0].content = 'x'.repeat(MAX_AGENT_SKILL_CONTENT - 10);
    for (const x of others.slice(1)) x.content = '';
    sk.content = 'y';
    const e = err(() => updateSkill(b, sk.id, { content: 'z'.repeat(20) }));
    expect(e.status).toBe(400);
    expect((e.details?.agents as string[]).length).toBeGreaterThan(0);
    expect(skillVersions(b, sk.id)).toHaveLength(1);
  });
});
