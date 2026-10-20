import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MAX_AGENT_SKILL_CONTENT,
  MAX_AGENT_SKILLS,
  MAX_SKILL_CONTENT,
  SKILL_TEMPLATES,
  type Agent as AgentContract,
  type ApiErrorResponse,
  type ApiResponse,
  type AuditEvent,
  type Department,
  type Skill,
  type SkillVersion,
} from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  truncateAll,
} from './utils';

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

const NIL = '00000000-0000-4000-8000-000000000000';

describe('Skill library (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;

  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let alice: LoggedInClient;
  let bob: LoggedInClient;
  let outsider: LoggedInClient;
  let agentId: string;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
    await setPlan(dataSource, owner.workspaceId, 'team');
    admin = await addMemberWithRole(dataSource, owner, 'admin');
    alice = await addMemberWithRole(dataSource, owner, 'member');
    bob = await addMemberWithRole(dataSource, owner, 'member');
    outsider = await registerAndLogin(app);
    const computer = await createComputer(dataSource, owner.workspaceId);
    agentId = (await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Alpha' })).id;
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (event: RealtimeEnvelope) => realtime.push(event));
  });

  // ---------- helpers ----------
  const raw = (verb: Verb, path: string, client: LoggedInClient, body?: object, query = '') =>
    request(app.getHttpServer())[verb](`/api/v1${path}${query}`).set(client.bearer).send(body);
  const call = async <T>(
    verb: Verb,
    path: string,
    client: LoggedInClient,
    body?: object,
    expected = 200,
  ): Promise<T> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const fail = async (
    verb: Verb,
    path: string,
    client: LoggedInClient,
    status: number,
    body?: object,
  ): Promise<ApiErrorResponse> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(status);
    return response.body as ApiErrorResponse;
  };
  const create = (body: object, client = owner) => call<Skill>('post', '/skills', client, body);
  const skill = (name: string, client = owner, extra: object = {}) =>
    create({ name, description: `Use for ${name}.`, content: `# ${name}`, ...extra }, client);
  const list = (client = owner) => call<Skill[]>('get', '/skills', client);
  const agentOf = (id = agentId, client = owner) =>
    call<AgentContract>('get', `/agents/${id}`, client);
  const setSkills = (skillIds: string[], client = owner, id = agentId) =>
    call<AgentContract>('put', `/agents/${id}/skills`, client, { skillIds });
  const eventTypes = () => realtime.map((e) => e.event.type);
  const audit = async () =>
    (await call<AuditEvent[]>('get', '/audit-events?limit=100', owner)).map((e) => e.action);
  const department = (name: string) => call<Department>('post', '/departments', owner, { name });
  const assign = (memberId: string, departmentId: string | null) =>
    call('put', `/members/${memberId}/department`, owner, { departmentId });

  // ---------- create / read ----------
  describe('POST /skills, GET /skills', () => {
    it('lets any member create a skill; the slug comes from the name without diacritics', async () => {
      const created = await skill('Báo giá khách hàng', alice);
      expect(created).toMatchObject({
        slug: 'bao-gia-khach-hang',
        name: 'Báo giá khách hàng',
        description: 'Use for Báo giá khách hàng.',
        content: '# Báo giá khách hàng',
        templateId: null,
        version: 1,
        createdById: alice.memberId,
        updatedById: alice.memberId,
        agentIds: [],
      });
      expect(eventTypes()).toContain('skills.changed');
      expect(await audit()).toContain('skill.created');

      expect(await call<Skill>('get', `/skills/${created.id}`, bob)).toEqual(created);
      expect(await list(bob)).toEqual([created]);
      const versions = await call<SkillVersion[]>('get', `/skills/${created.id}/versions`, bob);
      expect(versions).toEqual([
        {
          version: 1,
          name: created.name,
          description: created.description,
          content: created.content,
          editedById: alice.memberId,
          createdAt: expect.any(String),
        },
      ]);
    });

    it('suffixes a derived slug that is taken but rejects a given one with 409', async () => {
      expect((await skill('Báo giá')).slug).toBe('bao-gia');
      expect((await skill('Bao gia')).slug).toBe('bao-gia-2');
      expect((await skill('báo giá!')).slug).toBe('bao-gia-3');
      const body = await fail('post', '/skills', owner, 409, {
        slug: 'bao-gia',
        name: 'X',
        description: 'x',
        content: 'x',
      });
      expect(body.message).toBe('A skill with this slug already exists');
      expect((await skill('Custom', owner, { slug: 'my-slug' })).slug).toBe('my-slug');
      expect((await skill('日本語')).slug).toBe('skill');
      expect((await skill('日本語')).slug).toBe('skill-2');
    });

    it('keeps derived slugs within 64 characters', async () => {
      const long = 'a'.repeat(64);
      expect((await skill(long, owner, { slug: long })).slug).toBe(long);
      const second = await skill('a'.repeat(70));
      expect(second.slug).toBe(`${'a'.repeat(62)}-2`);
    });

    it('validates slug and fields', async () => {
      const ok = { name: 'N', description: 'd', content: 'c' };
      const bad: object[] = [
        {},
        { ...ok, slug: 'Has Upper' },
        { ...ok, slug: 'under_score' },
        { ...ok, slug: '' },
        { ...ok, slug: 'a'.repeat(65) },
        { ...ok, name: '' },
        { ...ok, name: '   ' },
        { ...ok, name: 'x'.repeat(81) },
        { ...ok, description: '' },
        { ...ok, description: 'x'.repeat(501) },
        { ...ok, content: '' },
        { ...ok, content: 'x'.repeat(MAX_SKILL_CONTENT + 1) },
        { name: 'N' },
      ];
      for (const body of bad) await fail('post', '/skills', owner, 400, body);
      expect(await list()).toEqual([]);
      const edge = await create({
        name: 'x'.repeat(80),
        description: 'd'.repeat(500),
        content: 'c'.repeat(MAX_SKILL_CONTENT),
      });
      expect(edge.content).toHaveLength(MAX_SKILL_CONTENT);
      // NUL cannot be stored in Postgres text: it is dropped, not a 500
      const nul = await create({ name: 'Nul', description: 'd\u0000x', content: 'a\u0000b\nc' });
      expect(nul).toMatchObject({ description: 'dx', content: 'ab\nc' });
    });

    it('creates from a template, with fields left out defaulting to it', async () => {
      const template = SKILL_TEMPLATES[0];
      const created = await create({ templateId: template.id }, alice);
      expect(created).toMatchObject({
        slug: template.slug,
        name: template.name,
        description: template.description,
        content: template.content,
        templateId: template.id,
        version: 1,
      });
      const tweaked = await create({ templateId: template.id, name: 'Mẫu của tôi' });
      expect(tweaked).toMatchObject({
        name: 'Mẫu của tôi',
        slug: 'mau-cua-toi',
        description: template.description,
        content: template.content,
        templateId: template.id,
      });
      await fail('post', '/skills', owner, 400, { templateId: 'no-such-template' });
      await fail('post', '/skills', owner, 400, { templateId: template.id, content: '' });
    });

    it('ships templates that fit the skill limits with unique slugs', () => {
      const slugs = SKILL_TEMPLATES.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const t of SKILL_TEMPLATES) {
        expect(t.id).toBe(t.slug);
        expect(t.slug).toMatch(/^[a-z0-9-]{1,64}$/);
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.name.length).toBeLessThanOrEqual(80);
        expect(t.description.length).toBeGreaterThan(0);
        expect(t.description.length).toBeLessThanOrEqual(500);
        expect(t.content.length).toBeGreaterThan(0);
        expect(t.content.length).toBeLessThanOrEqual(MAX_SKILL_CONTENT);
      }
    });

    it('treats foreign, malformed and unknown ids as 404 and isolates workspaces', async () => {
      const mine = await skill('Mine');
      await call('get', `/skills/${mine.id}`, outsider, undefined, 404);
      await call('get', `/skills/${mine.id}/versions`, outsider, undefined, 404);
      await call('patch', `/skills/${mine.id}`, outsider, { name: 'Hacked' }, 404);
      await call('post', `/skills/${mine.id}/restore`, outsider, { version: 1 }, 404);
      await call('delete', `/skills/${mine.id}`, outsider, undefined, 404);
      for (const id of ['nope', NIL]) await call('get', `/skills/${id}`, owner, undefined, 404);
      expect(await list(outsider)).toEqual([]);
      // the outsider's own library can reuse the slug
      expect((await skill('Mine', outsider)).slug).toBe('mine');
      // and cannot put a foreign skill on their own agent
      const computer = await createComputer(dataSource, outsider.workspaceId);
      const foreignAgent = await createAgent(dataSource, outsider.workspaceId, computer.id);
      await call(
        'put',
        `/agents/${foreignAgent.id}/skills`,
        outsider,
        { skillIds: [mine.id] },
        404,
      );
      await call('put', `/agents/${agentId}/skills`, outsider, { skillIds: [] }, 404);
    });
  });

  // ---------- update / versions / restore ----------
  describe('PATCH /skills/:id, versions and restore', () => {
    it('bumps the version only when something changed, and keeps the history', async () => {
      const created = await skill('Báo giá', alice);
      const same = await call<Skill>('patch', `/skills/${created.id}`, alice, {
        name: created.name,
      });
      expect(same.version).toBe(1);
      realtime = [];

      const edited = await call<Skill>('patch', `/skills/${created.id}`, alice, {
        content: '# v2',
        description: 'New description',
      });
      expect(edited).toMatchObject({
        version: 2,
        content: '# v2',
        description: 'New description',
        name: 'Báo giá',
        slug: 'bao-gia',
        updatedById: alice.memberId,
      });
      expect(eventTypes()).toContain('skills.changed');
      const renamed = await call<Skill>('patch', `/skills/${created.id}`, owner, { name: 'Giá' });
      expect(renamed).toMatchObject({ version: 3, slug: 'bao-gia', updatedById: owner.memberId });
      await fail('patch', `/skills/${created.id}`, owner, 400, { content: '' });
      await fail('patch', `/skills/${created.id}`, owner, 400, { name: 'x'.repeat(81) });

      const versions = await call<SkillVersion[]>('get', `/skills/${created.id}/versions`, bob);
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
      expect(versions.map((v) => v.editedById)).toEqual([
        owner.memberId,
        alice.memberId,
        alice.memberId,
      ]);
      expect(versions[2]).toMatchObject({ name: 'Báo giá', content: '# Báo giá' });

      const restored = await call<Skill>('post', `/skills/${created.id}/restore`, alice, {
        version: 1,
      });
      expect(restored).toMatchObject({
        version: 4,
        name: 'Báo giá',
        content: '# Báo giá',
        description: 'Use for Báo giá.',
      });
      expect(
        (await call<SkillVersion[]>('get', `/skills/${created.id}/versions`, alice)).map(
          (v) => v.version,
        ),
      ).toEqual([4, 3, 2, 1]);
      await fail('post', `/skills/${created.id}/restore`, alice, 404, { version: 9 });
      await fail('post', `/skills/${created.id}/restore`, alice, 400, { version: 0 });
      await fail('post', `/skills/${created.id}/restore`, alice, 400, {});
      const actions = await audit();
      expect(actions).toEqual(expect.arrayContaining(['skill.updated', 'skill.restored']));
    });

    it('lets only the creator, an owner or an admin change or delete a skill', async () => {
      const created = await skill('Báo giá', alice);
      const forbidden = await fail('patch', `/skills/${created.id}`, bob, 403, { name: 'Mine' });
      expect(forbidden.message).toBe(
        'Only the creator, an owner or an admin can change this skill',
      );
      await fail('post', `/skills/${created.id}/restore`, bob, 403, { version: 1 });
      await fail('delete', `/skills/${created.id}`, bob, 403);
      expect((await call<Skill>('get', `/skills/${created.id}`, bob)).version).toBe(1);

      await call('patch', `/skills/${created.id}`, alice, { name: 'By creator' });
      await call('patch', `/skills/${created.id}`, admin, { name: 'By admin' });
      await call('patch', `/skills/${created.id}`, owner, { name: 'By owner' });
      await call('post', `/skills/${created.id}/restore`, admin, { version: 1 });
      await call('delete', `/skills/${created.id}`, admin);
    });

    /** Nine 20k skills and one 19k skill on `Alpha` (199 000), plus a tiny `target` skill (1). */
    const nearlyFullAgent = async () => {
      const ids: string[] = [];
      for (let i = 0; i < 9; i++) {
        ids.push((await skill(`big${i}`, owner, { content: 'x'.repeat(MAX_SKILL_CONTENT) })).id);
      }
      ids.push((await skill('medium', owner, { content: 'x'.repeat(19_000) })).id);
      const target = await skill('target', owner, { content: 'x'.repeat(MAX_SKILL_CONTENT) });
      await call<Skill>('patch', `/skills/${target.id}`, owner, { content: 'x' });
      await setSkills([...ids, target.id]);
      return target;
    };

    it('refuses an edit that pushes an agent past the total content limit, naming the agents', async () => {
      const target = await nearlyFullAgent();
      const body = await fail('patch', `/skills/${target.id}`, owner, 400, {
        content: 'x'.repeat(1_001),
      });
      expect(body.message).toBe(
        `The skills of an agent can hold at most ${MAX_AGENT_SKILL_CONTENT} characters in total`,
      );
      expect(JSON.stringify(body)).toContain('Alpha');
      expect((await call<Skill>('get', `/skills/${target.id}`, owner)).version).toBe(2);
      // exactly at the limit is fine, and a skill nobody uses is only bound by its own limit
      await call('patch', `/skills/${target.id}`, owner, { content: 'x'.repeat(1_000) });
      const free = await skill('free');
      await call('patch', `/skills/${free.id}`, owner, { content: 'x'.repeat(MAX_SKILL_CONTENT) });
    });

    it('applies the same limits to restore: per agent total and the skill length', async () => {
      const target = await nearlyFullAgent();
      // version 1 holds 20 000 characters: restoring it would make Alpha hold 219 000
      const body = await fail('post', `/skills/${target.id}/restore`, owner, 400, { version: 1 });
      expect(body.message).toContain('in total');
      expect(JSON.stringify(body)).toContain('Alpha');
      expect((await call<Skill>('get', `/skills/${target.id}`, owner)).version).toBe(2);

      await dataSource.query(
        `UPDATE skill_versions SET content = repeat('y', $1::int) WHERE skill_id = $2 AND version = 1`,
        [MAX_SKILL_CONTENT + 1, target.id],
      );
      const long = await fail('post', `/skills/${target.id}/restore`, owner, 400, { version: 1 });
      expect(long.message).toBe(`A skill can hold at most ${MAX_SKILL_CONTENT} characters`);
      expect((await call<Skill>('get', `/skills/${target.id}`, owner)).version).toBe(2);
    });

    it('records the actor and the number of agents in the skill.updated audit row', async () => {
      const created = await skill('Báo giá', alice);
      await setSkills([created.id]);
      await call('patch', `/skills/${created.id}`, alice, { content: '# changed' });
      const rows = await call<AuditEvent[]>('get', '/audit-events?limit=100', owner);
      const row = rows.find((e) => e.action === 'skill.updated')!;
      expect(row.actor?.id).toBe(alice.memberId);
      expect(row.targetId).toBe(created.id);
      expect(row.meta).toMatchObject({
        slug: 'bao-gia',
        from: 1,
        to: 2,
        fields: ['content'],
        agents: 1,
      });
    });

    it('lists the agents using a skill, and an edit tells the agents list too', async () => {
      const created = await skill('Báo giá');
      const other = await skill('Khác');
      await setSkills([created.id]);
      expect((await list()).find((s) => s.id === created.id)!.agentIds).toEqual([agentId]);
      expect((await list()).find((s) => s.id === other.id)!.agentIds).toEqual([]);
      realtime = [];
      await call('patch', `/skills/${created.id}`, owner, { content: '# changed' });
      expect(eventTypes()).toEqual(expect.arrayContaining(['skills.changed', 'agents.changed']));
      realtime = [];
      await call('patch', `/skills/${other.id}`, owner, { content: '# changed' });
      expect(eventTypes()).not.toContain('agents.changed');
    });
  });

  // ---------- delete ----------
  describe('DELETE /skills/:id', () => {
    it('refuses while a live agent has the skill on, naming the agents', async () => {
      const created = await skill('Báo giá');
      await setSkills([created.id]);
      const body = await fail('delete', `/skills/${created.id}`, owner, 409);
      expect(body.message).toBe('The skill is enabled on agents; turn it off there first');
      expect(body.meta?.details).toEqual({ agents: ['Alpha'] });

      await setSkills([]);
      realtime = [];
      await call('delete', `/skills/${created.id}`, owner);
      expect(eventTypes()).toContain('skills.changed');
      expect(await audit()).toContain('skill.deleted');
      await call('get', `/skills/${created.id}`, owner, undefined, 404);
      expect(await list()).toEqual([]);
      // the slug is free again, the old row stays soft-deleted
      expect((await skill('Báo giá')).slug).toBe('bao-gia');
      const rows = await dataSource.query(`SELECT count(*)::int AS n FROM skills`);
      expect((rows as { n: number }[])[0].n).toBe(2);
    });

    it('does not count a deleted agent as a user', async () => {
      const created = await skill('Báo giá');
      await setSkills([created.id]);
      await call('delete', `/agents/${agentId}`, owner);
      await call('delete', `/skills/${created.id}`, owner);
    });
  });

  // ---------- agent skills ----------
  describe('PUT /agents/:id/skills', () => {
    it('sets the full enabled set and lists every library skill on the agent, by name', async () => {
      const b = await skill('Bravo');
      const a = await skill('alpha');
      const c = await skill('Charlie');
      expect((await agentOf()).skills).toEqual([
        { id: a.id, name: 'alpha', enabled: false },
        { id: b.id, name: 'Bravo', enabled: false },
        { id: c.id, name: 'Charlie', enabled: false },
      ]);
      realtime = [];
      const updated = await setSkills([c.id, a.id, c.id]);
      expect(updated.skills.map((s) => [s.name, s.enabled])).toEqual([
        ['alpha', true],
        ['Bravo', false],
        ['Charlie', true],
      ]);
      expect(eventTypes()).toEqual(expect.arrayContaining(['agents.changed', 'skills.changed']));
      expect(await audit()).toContain('agent.skills_changed');
      expect(await agentOf()).toEqual(updated);
      expect((await list()).find((s) => s.id === a.id)!.agentIds).toEqual([agentId]);

      expect((await setSkills([b.id])).skills.map((s) => s.enabled)).toEqual([false, true, false]);
      expect((await setSkills([])).skills.every((s) => !s.enabled)).toBe(true);
    });

    it('does not announce or audit an unchanged set', async () => {
      const a = await skill('alpha');
      await setSkills([a.id]);
      realtime = [];
      const before = (await audit()).filter((x) => x === 'agent.skills_changed').length;
      await setSkills([a.id]);
      expect(eventTypes()).not.toContain('skills.changed');
      expect((await audit()).filter((x) => x === 'agent.skills_changed').length).toBe(before);
    });

    it('is open to owner/admin for any agent and to a member only inside their department', async () => {
      const a = await skill('alpha');
      const sales = await department('Kinh doanh');
      const tech = await department('Kỹ thuật');
      await assign(alice.memberId, sales.id);
      await assign(bob.memberId, tech.id);
      await call('put', `/agents/${agentId}/department`, owner, { departmentId: sales.id });

      // no department at all, and another department
      const carol = await addMemberWithRole(dataSource, owner, 'member');
      for (const who of [carol, bob]) {
        const body = await fail('put', `/agents/${agentId}/skills`, who, 403, { skillIds: [a.id] });
        expect(body.message).toBe(
          "Only an owner, an admin or a member of the agent's department can change its skills",
        );
      }
      expect((await agentOf()).skills.every((s) => !s.enabled)).toBe(true);

      expect((await setSkills([a.id], alice)).skills[0].enabled).toBe(true);
      expect((await setSkills([], admin)).skills[0].enabled).toBe(false);
      expect((await setSkills([a.id], owner)).skills[0].enabled).toBe(true);

      // an agent without a department is out of reach for members, even those without one
      await call('put', `/agents/${agentId}/department`, owner, { departmentId: null });
      await fail('put', `/agents/${agentId}/skills`, alice, 403, { skillIds: [] });
      await fail('put', `/agents/${agentId}/skills`, carol, 403, { skillIds: [] });
      await setSkills([], admin);
    });

    it('validates the ids and the limits', async () => {
      const a = await skill('alpha');
      await fail('put', `/agents/${agentId}/skills`, owner, 404, { skillIds: [NIL] });
      await fail('put', `/agents/${agentId}/skills`, owner, 404, { skillIds: ['nope'] });
      await fail('put', `/agents/${agentId}/skills`, owner, 404, { skillIds: [a.id, NIL] });
      await fail('put', `/agents/${NIL}/skills`, owner, 404, { skillIds: [] });
      await fail('put', `/agents/nope/skills`, owner, 404, { skillIds: [] });
      await fail('put', `/agents/${agentId}/skills`, owner, 400, {});
      await fail('put', `/agents/${agentId}/skills`, owner, 400, { skillIds: 'x' });
      await fail('put', `/agents/${agentId}/skills`, owner, 400, { skillIds: [1] });
      const gone = await skill('gone');
      await call('delete', `/skills/${gone.id}`, owner);
      await fail('put', `/agents/${agentId}/skills`, owner, 404, { skillIds: [gone.id] });
      expect((await agentOf()).skills.every((s) => !s.enabled)).toBe(true);

      const many: string[] = [];
      for (let i = 0; i <= MAX_AGENT_SKILLS; i++) many.push((await skill(`s${i}`)).id);
      const tooMany = await fail('put', `/agents/${agentId}/skills`, owner, 400, {
        skillIds: many,
      });
      expect(tooMany.message).toBe(`An agent can have at most ${MAX_AGENT_SKILLS} skills`);
      expect(
        (await setSkills(many.slice(0, MAX_AGENT_SKILLS))).skills.filter((s) => s.enabled),
      ).toHaveLength(MAX_AGENT_SKILLS);
    });

    it('caps the total content of the skills of one agent', async () => {
      const count = Math.floor(MAX_AGENT_SKILL_CONTENT / MAX_SKILL_CONTENT) + 1;
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        ids.push((await skill(`big${i}`, owner, { content: 'x'.repeat(MAX_SKILL_CONTENT) })).id);
      }
      const body = await fail('put', `/agents/${agentId}/skills`, owner, 400, { skillIds: ids });
      expect(body.message).toBe(
        `The skills of an agent can hold at most ${MAX_AGENT_SKILL_CONTENT} characters in total`,
      );
      expect((await setSkills(ids.slice(1))).skills.filter((s) => s.enabled)).toHaveLength(
        count - 1,
      );
    });
  });

  // ---------- through POST/PATCH /agents ----------
  describe('skills on POST /agents and PATCH /agents/:id', () => {
    it('enables library skills on create and toggles them on update (owner/admin only)', async () => {
      const a = await skill('alpha');
      const b = await skill('bravo');
      const computer = await createComputer(dataSource, owner.workspaceId, { name: 'second' });
      const created = await call<AgentContract>('post', '/agents', owner, {
        name: 'Beta',
        computerId: computer.id,
        skills: [
          { id: a.id, enabled: true },
          { id: b.id, enabled: false },
        ],
      });
      expect(created.skills).toEqual([
        { id: a.id, name: 'alpha', enabled: true },
        { id: b.id, name: 'bravo', enabled: false },
      ]);
      await fail('post', '/agents', owner, 404, {
        name: 'Gamma',
        computerId: computer.id,
        skills: [{ id: NIL, enabled: true }],
      });
      const patched = await call<AgentContract>('patch', `/agents/${created.id}`, owner, {
        skills: [
          { id: b.id, enabled: true },
          { id: a.id, enabled: false },
        ],
      });
      expect(patched.skills.map((s) => s.enabled)).toEqual([false, true]);
      await fail('patch', `/agents/${created.id}`, alice, 403, { skills: [] });
      await fail('patch', `/agents/${created.id}`, owner, 404, {
        skills: [{ id: NIL, enabled: true }],
      });
      // disabling an unknown id is harmless
      await call('patch', `/agents/${created.id}`, owner, {
        skills: [{ id: NIL, enabled: false }],
      });
      expect(await audit()).toContain('agent.skills_changed');
    });

    it('removes the old catalog endpoint', async () => {
      await call('get', '/agents/skill-catalog', owner, undefined, 404);
    });
  });
});
