/** Icon names a department may use; a subset of the FE icon set. */
export const DEPARTMENT_ICONS = [
  'users',
  'chat',
  'chart',
  'table',
  'terminal',
  'monitor',
  'shield',
  'sparkles',
  'zap',
  'phone',
  'inbox',
  'file',
  'clock',
  'hash',
  'kanban',
] as const;

export type DepartmentIcon = (typeof DEPARTMENT_ICONS)[number];

export const DEFAULT_DEPARTMENT_ICON: DepartmentIcon = 'users';
export const MAX_DEPARTMENT_NAME = 60;
/** Job title of a member or an agent. */
export const MAX_TITLE = 80;

export interface Department {
  id: string;
  name: string;
  icon: DepartmentIcon;
  /** Display order, 0-based. */
  rank: number;
  /** The department's public channel; `null` when it was deleted since. */
  roomId: string | null;
}

export interface CreateDepartmentInput {
  /** 1..60 characters after trimming, unique per workspace (case-insensitive). */
  name: string;
  /** Defaults to `users`. */
  icon?: DepartmentIcon;
}

export interface UpdateDepartmentInput {
  /** The department's room keeps its name. */
  name?: string;
  icon?: DepartmentIcon;
}

/** Must list exactly the live departments. */
export interface ReorderDepartmentsInput {
  ids: string[];
}

export interface SetDepartmentInput {
  /** `null` = no department. */
  departmentId: string | null;
}

export interface SetMemberTitleInput {
  /** Trimmed, at most 80 characters; empty or `null` clears it. */
  title: string | null;
}
