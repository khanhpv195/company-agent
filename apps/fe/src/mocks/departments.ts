import {
  DEFAULT_DEPARTMENT_ICON,
  DEPARTMENT_ICONS,
  MAX_DEPARTMENT_NAME,
  MAX_TITLE,
  type Department,
  type DepartmentIcon,
} from '@repo/shared';
import { normalizeDepartmentName } from '../features/departments/departments.logic';
import { HttpError, type MockBackend } from './backend';
import { createRoom } from './chat';

const isIcon = (v: unknown): v is DepartmentIcon =>
  typeof v === 'string' && (DEPARTMENT_ICONS as readonly string[]).includes(v);

/** `Kế toán` -> `ke-toan` (the department channel name). */
export const roomSlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'phong-ban';

/** Stored department name: trimmed, inner whitespace runs collapsed to one space (like the API). */
const clean = (raw: unknown): string => {
  const name = typeof raw === 'string' ? normalizeDepartmentName(raw) : '';
  if (!name || name.length > MAX_DEPARTMENT_NAME)
    throw new HttpError(400, `Tên phòng ban cần từ 1 đến ${MAX_DEPARTMENT_NAME} ký tự`);
  return name;
};

/** A title is trimmed; empty or null clears it. */
export function cleanTitle(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new HttpError(400, 'Chức danh không hợp lệ');
  const title = raw.trim();
  if (title.length > MAX_TITLE) throw new HttpError(400, `Chức danh tối đa ${MAX_TITLE} ký tự`);
  return title || null;
}

export const liveDepartments = (b: MockBackend): Department[] =>
  [...b.db.departments].sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));

export function departmentOr404(b: MockBackend, id: string): Department {
  const d = b.db.departments.find((x) => x.id === id);
  if (!d) throw new HttpError(404, 'Không tìm thấy phòng ban');
  return d;
}

/** `null` clears; an unknown id is a 404. */
export function assertDepartmentId(b: MockBackend, id: unknown): string | null {
  if (id === null || id === undefined) return null;
  if (typeof id !== 'string') throw new HttpError(400, 'Phòng ban không hợp lệ');
  return departmentOr404(b, id).id;
}

function assertNameFree(b: MockBackend, name: string, exceptId?: string) {
  if (
    b.db.departments.some(
      (d) => d.id !== exceptId && normalizeDepartmentName(d.name) === normalizeDepartmentName(name),
    )
  )
    throw new HttpError(409, 'Đã có phòng ban trùng tên');
}

export function createDepartment(b: MockBackend, input: { name?: unknown; icon?: unknown }) {
  const name = clean(input.name);
  assertNameFree(b, name);
  if (input.icon !== undefined && !isIcon(input.icon))
    throw new HttpError(400, 'Biểu tượng không hợp lệ');
  const base = roomSlug(name);
  const taken = (n: string) =>
    b.db.rooms.some((r) => r.kind === 'channel' && r.name.toLowerCase() === n);
  let roomName = base;
  for (let i = 2; taken(roomName); i++) roomName = `${base}-${i}`;
  const room = createRoom(b, { name: roomName });
  const department: Department = {
    id: b.nextId('dept'),
    name,
    icon: isIcon(input.icon) ? input.icon : DEFAULT_DEPARTMENT_ICON,
    rank: b.db.departments.length,
    roomId: room.id,
  };
  b.db.departments.push(department);
  b.emit({ type: 'departments.changed' });
  return department;
}

export function updateDepartment(
  b: MockBackend,
  id: string,
  input: { name?: unknown; icon?: unknown },
) {
  const d = departmentOr404(b, id);
  if (input.name !== undefined) {
    const name = clean(input.name);
    assertNameFree(b, name, d.id);
    d.name = name;
  }
  if (input.icon !== undefined) {
    if (!isIcon(input.icon)) throw new HttpError(400, 'Biểu tượng không hợp lệ');
    d.icon = input.icon;
  }
  b.emit({ type: 'departments.changed' });
  return d;
}

export function deleteDepartment(b: MockBackend, id: string) {
  const d = departmentOr404(b, id);
  b.db.departments = b.db.departments.filter((x) => x !== d);
  b.db.departments.sort((x, y) => x.rank - y.rank).forEach((x, i) => (x.rank = i));
  for (const m of b.db.members) if (m.departmentId === id) m.departmentId = null;
  for (const a of b.db.agents) if (a.departmentId === id) a.departmentId = null;
  b.emit({ type: 'departments.changed' });
  b.emit({ type: 'members.changed' });
  b.emit({ type: 'agents.changed' });
}

export function reorderDepartments(b: MockBackend, ids: unknown) {
  const live = b.db.departments.map((d) => d.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== live.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((x) => live.includes(x as string))
  )
    throw new HttpError(400, 'Danh sách phòng ban không khớp');
  ids.forEach((id, rank) => {
    b.db.departments.find((d) => d.id === id)!.rank = rank;
  });
  b.emit({ type: 'departments.changed' });
  return liveDepartments(b);
}

/** Assigning adds the person to the department channel; the old channel is kept. */
export function joinDepartmentRoom(
  b: MockBackend,
  departmentId: string | null,
  kind: 'member' | 'agent',
  id: string,
) {
  const roomId = departmentId ? b.db.departments.find((d) => d.id === departmentId)?.roomId : null;
  const room = roomId ? b.db.rooms.find((r) => r.id === roomId) : null;
  const roster = roomId ? b.db.roster[roomId] : null;
  if (!room || !roster) return;
  const list = kind === 'member' ? roster.memberIds : roster.agentIds;
  if (list.includes(id)) return;
  list.push(id);
  room.memberCount = roster.memberIds.length;
  room.agentCount = roster.agentIds.length;
  b.emit({ type: 'rooms.changed' });
}
