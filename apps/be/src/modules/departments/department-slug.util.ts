import { slugify } from '../workspace/slug.util';

/** Used when a department name has no ascii letter or digit left (e.g. only symbols). */
export const DEPARTMENT_ROOM_FALLBACK = 'phong-ban';

/** `Kế toán` -> `ke-toan`: the name of a department's room, before any collision suffix. */
export const departmentRoomSlug = (name: string): string => slugify(name, DEPARTMENT_ROOM_FALLBACK);

/** The first of `slug`, `slug-2`, `slug-3`... that is not in `taken` (lower-case names). */
export const firstFreeRoomName = (slug: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
};
