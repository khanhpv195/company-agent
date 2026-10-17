import { isUUID } from 'class-validator';

/** Position of an audit event in the newest-first order. `at` is a lossless ISO string. */
export interface AuditCursor {
  at: string;
  id: string;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Opaque to clients: base64url of `<iso>|<id>`. */
export const encodeAuditCursor = (cursor: AuditCursor): string =>
  Buffer.from(`${cursor.at}|${cursor.id}`, 'utf8').toString('base64url');

/** `null` for anything that is not a cursor this service produced. */
export const decodeAuditCursor = (value: unknown): AuditCursor | null => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) return null;
  const [at, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || !at || !id) return null;
  if (!ISO_UTC.test(at) || Number.isNaN(Date.parse(at)) || !isUUID(id)) return null;
  return { at, id };
};
