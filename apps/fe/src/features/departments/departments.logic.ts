import { MAX_DEPARTMENT_NAME, MAX_TITLE, type Department } from '@repo/shared';

export interface PeopleGroup<A, M> {
  /** `null` is the "no department" group. */
  department: Department | null;
  agents: A[];
  members: M[];
}

interface InDepartment {
  departmentId: string | null;
}

/** Departments in display order: rank, then name (the API already sends them this way). */
export const sortDepartments = (departments: readonly Department[]): Department[] =>
  [...departments].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

/**
 * People side panel groups: every department in rank order (empty ones included), each with
 * its agents then its members, and a final "no department" group. An id that matches no live
 * department counts as unassigned. The final group is left out only when it would be empty
 * and at least one department exists.
 */
export function groupByDepartment<A extends InDepartment, M extends InDepartment>(
  departments: readonly Department[],
  agents: readonly A[],
  members: readonly M[],
): PeopleGroup<A, M>[] {
  const sorted = sortDepartments(departments);
  const known = new Set(sorted.map((d) => d.id));
  const groups: PeopleGroup<A, M>[] = sorted.map((department) => ({
    department,
    agents: agents.filter((a) => a.departmentId === department.id),
    members: members.filter((m) => m.departmentId === department.id),
  }));
  const rest: PeopleGroup<A, M> = {
    department: null,
    agents: agents.filter((a) => !a.departmentId || !known.has(a.departmentId)),
    members: members.filter((m) => !m.departmentId || !known.has(m.departmentId)),
  };
  if (rest.agents.length || rest.members.length || !sorted.length) groups.push(rest);
  return groups;
}

export interface DepartmentCounts {
  members: number;
  agents: number;
}

export function departmentCounts(
  departmentId: string,
  agents: readonly InDepartment[],
  members: readonly InDepartment[],
): DepartmentCounts {
  return {
    members: members.filter((m) => m.departmentId === departmentId).length,
    agents: agents.filter((a) => a.departmentId === departmentId).length,
  };
}

/** New id order after moving `id` one step (`-1` up, `1` down); unchanged at the ends. */
export function moveId(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export const isDepartmentNameValid = (name: string): boolean => {
  const n = name.trim();
  return n.length >= 1 && n.length <= MAX_DEPARTMENT_NAME;
};

/** Comparison key for department names: trimmed, inner whitespace runs as one space, lowercase. */
export const normalizeDepartmentName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Case- and space-insensitive duplicate check, like the API (`exceptId` = the one being edited). */
export const isDepartmentNameTaken = (
  departments: readonly Pick<Department, 'id' | 'name'>[],
  name: string,
  exceptId?: string,
): boolean => {
  const key = normalizeDepartmentName(name);
  return departments.some((d) => d.id !== exceptId && normalizeDepartmentName(d.name) === key);
};

export const isTitleValid = (title: string): boolean => title.trim().length <= MAX_TITLE;

/** What the API stores: trimmed, empty means no title. */
export const cleanTitle = (title: string): string | null => title.trim() || null;

/** Owner/admin edit anyone; everyone edits their own. */
export const canEditTitle = (
  actor: { id: string; role: string | undefined },
  targetMemberId: string,
): boolean => actor.role === 'owner' || actor.role === 'admin' || actor.id === targetMemberId;

/** "Title · hint", or just the hint when there is no title. */
export const withTitle = (title: string | null | undefined, hint: string): string =>
  title?.trim() ? (hint ? `${title.trim()} · ${hint}` : title.trim()) : hint;
