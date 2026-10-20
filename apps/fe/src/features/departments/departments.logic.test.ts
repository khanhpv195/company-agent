import type { Department } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  canEditTitle,
  cleanTitle,
  departmentCounts,
  groupByDepartment,
  isDepartmentNameTaken,
  isDepartmentNameValid,
  isTitleValid,
  moveId,
  sortDepartments,
  withTitle,
} from './departments.logic';

const dep = (id: string, name: string, rank: number): Department => ({
  id,
  name,
  icon: 'users',
  rank,
  roomId: null,
});
const D = [dep('b', 'Kỹ thuật', 1), dep('a', 'Kinh doanh', 0), dep('c', 'Trống', 2)];
const agent = (id: string, departmentId: string | null) => ({ id, departmentId });
const member = (id: string, departmentId: string | null) => ({ id, departmentId });

describe('groupByDepartment', () => {
  it('groups in rank order, agents then members, empty departments included', () => {
    const groups = groupByDepartment(
      D,
      [agent('a1', 'b'), agent('a2', 'a')],
      [member('m1', 'a'), member('m2', 'b'), member('m3', null)],
    );
    expect(groups.map((g) => g.department?.id ?? null)).toEqual(['a', 'b', 'c', null]);
    expect(groups[0].agents.map((x) => x.id)).toEqual(['a2']);
    expect(groups[0].members.map((x) => x.id)).toEqual(['m1']);
    expect(groups[2]).toMatchObject({ agents: [], members: [] });
    expect(groups[3].members.map((x) => x.id)).toEqual(['m3']);
  });
  it('treats an unknown department id as unassigned', () => {
    const groups = groupByDepartment(D, [agent('a1', 'gone')], []);
    const last = groups[groups.length - 1];
    expect(last.department).toBeNull();
    expect(last.agents.map((x) => x.id)).toEqual(['a1']);
  });
  it('drops the empty "no department" group only when departments exist', () => {
    expect(groupByDepartment(D, [], []).map((g) => g.department?.id ?? null)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(groupByDepartment([], [], [])).toEqual([{ department: null, agents: [], members: [] }]);
  });
});

describe('department helpers', () => {
  it('sorts by rank then name', () => {
    expect(
      sortDepartments([dep('x', 'B', 1), dep('y', 'A', 1), dep('z', 'C', 0)]).map((d) => d.id),
    ).toEqual(['z', 'y', 'x']);
  });
  it('counts members and agents', () => {
    expect(departmentCounts('a', [agent('a1', 'a'), agent('a2', 'b')], [member('m', 'a')])).toEqual(
      { members: 1, agents: 1 },
    );
  });
  it('moves an id one step and stays put at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a'], 'zzz', 1)).toEqual(['a']);
  });
  it('validates names and finds duplicates like the API', () => {
    expect(isDepartmentNameValid('  ')).toBe(false);
    expect(isDepartmentNameValid('a'.repeat(61))).toBe(false);
    expect(isDepartmentNameValid(' Kế toán ')).toBe(true);
    expect(isDepartmentNameTaken(D, '  kinh DOANH ')).toBe(true);
    expect(isDepartmentNameTaken(D, 'kinh doanh', 'a')).toBe(false);
    expect(isDepartmentNameTaken(D, 'Nhân sự')).toBe(false);
  });
  it('treats runs of spaces as one space when checking duplicates', () => {
    expect(isDepartmentNameTaken(D, 'Kinh  doanh')).toBe(true);
    expect(isDepartmentNameTaken(D, ' Kinh \t doanh ')).toBe(true);
    expect(isDepartmentNameTaken([dep('x', 'Kinh  doanh', 0)], 'kinh doanh')).toBe(true);
    expect(isDepartmentNameTaken(D, 'Kinh  doanh', 'a')).toBe(false);
  });
});

describe('titles', () => {
  it('cleans and validates', () => {
    expect(cleanTitle('  Head of Sales ')).toBe('Head of Sales');
    expect(cleanTitle('   ')).toBeNull();
    expect(isTitleValid('a'.repeat(80))).toBe(true);
    expect(isTitleValid('a'.repeat(81))).toBe(false);
  });
  it('lets owner/admin edit anyone and everyone edit themselves', () => {
    expect(canEditTitle({ id: 'u1', role: 'owner' }, 'u2')).toBe(true);
    expect(canEditTitle({ id: 'u1', role: 'admin' }, 'u2')).toBe(true);
    expect(canEditTitle({ id: 'u1', role: 'member' }, 'u2')).toBe(false);
    expect(canEditTitle({ id: 'u1', role: 'member' }, 'u1')).toBe(true);
    expect(canEditTitle({ id: 'u1', role: undefined }, 'u1')).toBe(true);
  });
  it('puts the title before the hint', () => {
    expect(withTitle('Head', 'Member')).toBe('Head · Member');
    expect(withTitle(null, 'Member')).toBe('Member');
    expect(withTitle(' ', 'Member')).toBe('Member');
    expect(withTitle('Head', '')).toBe('Head');
  });
});
