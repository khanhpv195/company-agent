import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor';

const ID = '3f0f8c0e-6d7a-4c52-9a53-2d4d3a1f0001';

describe('audit cursor', () => {
  it('round-trips', () => {
    const cursor = { at: '2026-01-02T03:04:05.123456Z', id: ID };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  it.each([
    undefined,
    '',
    'yesterday',
    '2026-01-02T03:04:05.123Z',
    Buffer.from('nope|nope').toString('base64url'),
    Buffer.from(`2026-13-45T03:04:05.123Z|${ID}`).toString('base64url'),
    Buffer.from(`2026-01-02T03:04:05.123Z|${ID}|x`).toString('base64url'),
    'a'.repeat(300),
  ])('rejects %p', (value) => {
    expect(decodeAuditCursor(value)).toBeNull();
  });
});
