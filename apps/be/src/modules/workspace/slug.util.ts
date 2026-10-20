/** Lowercase ascii, `-`-joined. Falls back to `fallback` (default `workspace`) when nothing usable remains. */
export const slugify = (value: string, fallback = 'workspace'): string => {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
};
