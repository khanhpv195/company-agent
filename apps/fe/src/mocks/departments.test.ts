import type { RealtimeEvent } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { MockBackend } from './backend';
import {
  createDepartment,
  deleteDepartment,
  reorderDepartments,
  roomSlug,
  updateDepartment,
} from './departments';

function setup() {
  const b = new MockBackend({ random: () => 0.99, later: () => undefined });
  const events: RealtimeEvent[] = [];
  b.subscribe((e) => events.push(e));
  return { b, events };
}

describe('mock departments', () => {
  it('slugs names without diacritics', () => {
    expect(roomSlug('Kinh doanh')).toBe('kinh-doanh');
    expect(roomSlug('Kế toán')).toBe('ke-toan');
    expect(roomSlug('Đào tạo')).toBe('dao-tao');
  });

  it('creates a department with a channel, suffixing a colliding channel name', () => {
    const { b, events } = setup();
    const a = createDepartment(b, { name: 'Kế toán', icon: 'table' });
    expect(b.db.rooms.find((r) => r.id === a.roomId)?.name).toBe('ke-toan');
    expect(a.rank).toBe(2);
    const dupe = createDepartment(b, { name: 'Ke toan' });
    expect(b.db.rooms.find((r) => r.id === dupe.roomId)?.name).toBe('ke-toan-2');
    expect(events.some((e) => e.type === 'departments.changed')).toBe(true);
  });

  it('rejects duplicate names case-insensitively and bad input', () => {
    const { b } = setup();
    expect(() => createDepartment(b, { name: ' kinh DOANH ' })).toThrow();
    expect(() => createDepartment(b, { name: '  ' })).toThrow();
    expect(() => createDepartment(b, { name: 'X', icon: 'nope' })).toThrow();
    expect(() => updateDepartment(b, 'd-eng', { name: 'kinh doanh' })).toThrow();
  });

  it('reorders only with exactly the live ids', () => {
    const { b } = setup();
    expect(() => reorderDepartments(b, ['d-eng'])).toThrow();
    expect(() => reorderDepartments(b, ['d-eng', 'd-eng'])).toThrow();
    const out = reorderDepartments(b, ['d-eng', 'd-sales']);
    expect(out.map((d) => d.id)).toEqual(['d-eng', 'd-sales']);
  });

  it('delete clears assignments and keeps the room', () => {
    const { b } = setup();
    const d = createDepartment(b, { name: 'Tạm' });
    b.db.members[0].departmentId = d.id;
    b.db.agents[0].departmentId = d.id;
    deleteDepartment(b, d.id);
    expect(b.db.members[0].departmentId).toBeNull();
    expect(b.db.agents[0].departmentId).toBeNull();
    expect(b.db.rooms.some((r) => r.id === d.roomId)).toBe(true);
    expect(b.db.departments.map((x) => x.rank)).toEqual([0, 1]);
  });

  it('assigning an agent joins the department channel and validates the id', () => {
    const { b } = setup();
    const d = createDepartment(b, { name: 'Vận hành' });
    b.updateAgent(b.db.agents[0], { departmentId: d.id, title: '  Trợ lý ' });
    expect(b.db.agents[0]).toMatchObject({ departmentId: d.id, title: 'Trợ lý' });
    expect(b.db.roster[d.roomId!].agentIds).toContain(b.db.agents[0].id);
    expect(() => b.updateAgent(b.db.agents[0], { departmentId: 'nope' })).toThrow();
    b.updateAgent(b.db.agents[0], { departmentId: null, title: null });
    expect(b.db.agents[0]).toMatchObject({ departmentId: null, title: null });
  });
});
