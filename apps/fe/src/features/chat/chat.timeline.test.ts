import type { Message } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  continuesGroup,
  dayDiff,
  dayKey,
  GROUP_WINDOW_MS,
  maxSeq,
} from './chat.timeline';

const at = (y: number, mo: number, d: number, h = 10, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

let n = 0;
const msg = (over: Partial<Message> & { when: string; by?: string; seq?: number }): Message => ({
  id: `m${++n}`,
  chatId: 'r',
  roomId: 'r',
  parentId: null,
  author: { kind: 'human', id: over.by ?? 'u1' },
  createdAt: over.when,
  status: 'complete',
  markdown: 'x',
  assignment: null,
  draft: null,
  ...over,
});

describe('dayKey / dayDiff', () => {
  it('uses local calendar days', () => {
    expect(dayKey(at(2026, 3, 9, 23, 59))).toBe('2026-03-09');
    expect(dayDiff(at(2026, 3, 9, 23, 59), new Date(2026, 2, 10, 0, 1).getTime())).toBe(1);
    expect(dayDiff(at(2026, 3, 10, 0, 1), new Date(2026, 2, 10, 23, 0).getTime())).toBe(0);
    expect(dayDiff(at(2026, 3, 1), new Date(2026, 2, 10).getTime())).toBe(9);
  });
});

describe('continuesGroup', () => {
  it('groups the same author within 5 minutes', () => {
    const a = msg({ when: at(2026, 3, 9, 10, 0) });
    expect(continuesGroup(a, msg({ when: at(2026, 3, 9, 10, 4) }))).toBe(true);
    expect(
      continuesGroup(
        a,
        msg({ when: new Date(Date.parse(a.createdAt) + GROUP_WINDOW_MS + 1).toISOString() }),
      ),
    ).toBe(false);
  });
  it('never groups across authors, days, external senders or deleted messages', () => {
    const a = msg({ when: at(2026, 3, 9, 23, 58) });
    expect(continuesGroup(a, msg({ when: at(2026, 3, 9, 23, 59), by: 'u2' }))).toBe(false);
    expect(continuesGroup(a, msg({ when: at(2026, 3, 10, 0, 1) }))).toBe(false);
    const ext = (when: string) =>
      msg({ when, author: { kind: 'external', connectionId: 'zalo', name: 'Lan' } });
    expect(continuesGroup(ext(at(2026, 3, 9, 10, 0)), ext(at(2026, 3, 9, 10, 1)))).toBe(false);
    expect(continuesGroup(a, msg({ when: at(2026, 3, 9, 23, 59), deleted: true }))).toBe(false);
  });
});

describe('buildTimeline', () => {
  it('inserts a day divider before each new day and groups inside a day', () => {
    const rows = buildTimeline(
      [
        msg({ when: at(2026, 3, 9, 10, 0), seq: 1 }),
        msg({ when: at(2026, 3, 9, 10, 2), seq: 2 }),
        msg({ when: at(2026, 3, 10, 9, 0), seq: 3 }),
      ],
      { lastReadSeq: null },
    );
    expect(rows.map((r) => r.type)).toEqual(['day', 'msg', 'msg', 'day', 'msg']);
    expect(rows.filter((r) => r.type === 'msg').map((r) => r.type === 'msg' && r.grouped)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('puts the new-messages divider before the first message past the cursor', () => {
    const list = [
      msg({ when: at(2026, 3, 9, 10, 0), seq: 1 }),
      msg({ when: at(2026, 3, 9, 10, 1), seq: 2 }),
      msg({ when: at(2026, 3, 9, 10, 2), seq: 3, by: 'u2' }),
      msg({ when: at(2026, 3, 9, 10, 3), seq: 4, by: 'u2' }),
    ];
    const rows = buildTimeline(list, { lastReadSeq: 2, me: 'u1' });
    expect(rows.map((r) => r.type)).toEqual(['day', 'msg', 'msg', 'new', 'msg', 'msg']);
    expect(rows.find((r) => r.type === 'new')).toEqual({ type: 'new', count: 2 });
    // The message after the divider starts a fresh group.
    const after = rows[4];
    expect(after?.type === 'msg' && after.grouped).toBe(false);
  });

  it('skips the divider when nothing new, when disabled, and for my own messages', () => {
    const list = [
      msg({ when: at(2026, 3, 9, 10, 0), seq: 1 }),
      msg({ when: at(2026, 3, 9, 10, 1), seq: 2, by: 'me' }),
    ];
    expect(buildTimeline(list, { lastReadSeq: 2, me: 'me' }).some((r) => r.type === 'new')).toBe(
      false,
    );
    expect(buildTimeline(list, { lastReadSeq: 0, me: 'me' })).toContainEqual({
      type: 'new',
      count: 1,
    });
    expect(buildTimeline(list, { lastReadSeq: null }).some((r) => r.type === 'new')).toBe(false);
  });
});

describe('maxSeq', () => {
  it('ignores messages without a seq', () => {
    expect(maxSeq([msg({ when: at(2026, 3, 9), seq: 4 }), msg({ when: at(2026, 3, 9) })])).toBe(4);
    expect(maxSeq([])).toBe(0);
  });
});
