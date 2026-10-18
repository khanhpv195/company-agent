import type { Message, RoomTimelinePage, ThreadPage } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  flattenThread,
  flattenTimeline,
  mapTimeline,
  mergeOutbox,
  mergeReactions,
  upsertThread,
  upsertTimeline,
  withParticipant,
  type ThreadData,
  type TimelineData,
} from './chat.cache';

const m = (id: string, seq: number, over: Partial<Message> = {}): Message => ({
  id,
  chatId: 'r',
  roomId: 'r',
  parentId: null,
  seq,
  author: { kind: 'human', id: 'u1' },
  createdAt: new Date(2026, 0, 1, 10, seq).toISOString(),
  status: 'complete',
  markdown: id,
  assignment: null,
  draft: null,
  ...over,
});
const tl = (...pages: RoomTimelinePage[]): TimelineData => ({
  pages,
  pageParams: pages.map(() => undefined),
});
const th = (...pages: ThreadPage[]): ThreadData => ({
  pages,
  pageParams: pages.map(() => undefined),
});

describe('timeline cache', () => {
  const data = tl(
    { messages: [m('c', 3), m('d', 4)], hasMore: true },
    { messages: [m('a', 1), m('b', 2)], hasMore: false },
  );

  it('flattens pages oldest first (the newest page is first in the cache)', () => {
    expect(flattenTimeline(data).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('appends a new root to the newest page', () => {
    const next = upsertTimeline(data, m('e', 5))!;
    expect(flattenTimeline(next).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(next.pages[0]!.messages).toHaveLength(3);
  });

  it('replaces a known message in place and keeps its thread summary', () => {
    const withThread = tl({
      messages: [
        m('a', 1, {
          thread: { title: 't', replyCount: 2, lastReplyAt: null, participantIds: ['u1'] },
        }),
      ],
      hasMore: false,
    });
    const next = upsertTimeline(withThread, m('a', 1, { markdown: 'edited' }))!;
    expect(next.pages[0]!.messages[0]!.markdown).toBe('edited');
    expect(next.pages[0]!.messages[0]!.thread?.replyCount).toBe(2);
  });

  it('replaces the optimistic message by clientMessageId when the server echo arrives', () => {
    const local = tl({
      messages: [m('local-x', 0, { clientMessageId: 'x', seq: undefined })],
      hasMore: false,
    });
    const next = upsertTimeline(local, m('real', 7, { clientMessageId: 'x' }))!;
    expect(flattenTimeline(next).map((x) => x.id)).toEqual(['real']);
  });

  it('ignores replies (they belong to a thread) and missing caches', () => {
    expect(upsertTimeline(data, m('r1', 9, { parentId: 'a' }))).toBe(data);
    expect(upsertTimeline(undefined, m('z', 1))).toBeUndefined();
  });

  it('mapTimeline returns the same object when nothing changes', () => {
    expect(mapTimeline(data, (x) => x)).toBe(data);
    expect(
      flattenTimeline(mapTimeline(data, (x) => (x.id === 'b' ? { ...x, markdown: 'B' } : x))!)[1]!
        .markdown,
    ).toBe('B');
  });
});

describe('thread cache', () => {
  const data = th({
    root: m('root', 1),
    replies: [m('r1', 2, { parentId: 'root' })],
    hasMore: false,
  });

  it('appends a reply of this thread when every reply is loaded', () => {
    const next = upsertThread(data, m('r2', 3, { parentId: 'root' }))!;
    expect(flattenThread(next).replies.map((x) => x.id)).toEqual(['r1', 'r2']);
  });

  it('does not append while more replies are unloaded, and ignores other threads', () => {
    const partial = th({ root: m('root', 1), replies: [], hasMore: true });
    expect(upsertThread(partial, m('r2', 3, { parentId: 'root' }))).toBe(partial);
    expect(upsertThread(data, m('x', 3, { parentId: 'other' }))).toBe(data);
  });

  it('updates the root and dedupes an optimistic reply', () => {
    const edited = upsertThread(data, m('root', 1, { markdown: 'new' }))!;
    expect(flattenThread(edited).root!.markdown).toBe('new');
    const local = th({
      root: m('root', 1),
      replies: [m('local-c', 0, { parentId: 'root', clientMessageId: 'c', seq: undefined })],
      hasMore: false,
    });
    const next = upsertThread(local, m('real', 5, { parentId: 'root', clientMessageId: 'c' }))!;
    expect(flattenThread(next).replies.map((x) => x.id)).toEqual(['real']);
  });
});

describe('mergeOutbox', () => {
  const item = (cid: string, roomId = 'r', parentId: string | null = null) => ({
    clientMessageId: cid,
    roomId,
    parentId,
  });
  const toMsg = (o: { clientMessageId: string }) =>
    m(`local-${o.clientMessageId}`, 0, { clientMessageId: o.clientMessageId });

  it('adds pending items of the same place at the end and drops the ones already echoed', () => {
    const server = [m('a', 1), m('b', 2, { clientMessageId: 'sent' })];
    const out = mergeOutbox(
      server,
      [item('sent'), item('pending'), item('other-room', 'x'), item('in-thread', 'r', 'a')],
      'r',
      null,
      toMsg,
    );
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'local-pending']);
  });

  it('returns the same array when nothing is pending', () => {
    const server = [m('a', 1)];
    expect(mergeOutbox(server, [], 'r', null, toMsg)).toBe(server);
  });
});

describe('mergeReactions', () => {
  it('derives mine from memberIds when the list is complete', () => {
    const out = mergeReactions(undefined, [{ key: '👍', count: 2, memberIds: ['me', 'u2'] }], 'me');
    expect(out[0]!.mine).toBe(true);
    expect(
      mergeReactions(undefined, [{ key: '👍', count: 1, memberIds: ['u2'] }], 'me')[0]!.mine,
    ).toBe(false);
  });

  it('keeps the cached value when memberIds is truncated', () => {
    const cached = [{ key: '👍', count: 12, mine: true, memberIds: [] }];
    const incoming = [
      { key: '👍', count: 13, memberIds: Array.from({ length: 10 }, (_, i) => `u${i}`) },
    ];
    expect(mergeReactions(cached, incoming, 'me')[0]!.mine).toBe(true);
    expect(mergeReactions(undefined, incoming, 'me')[0]!.mine).toBe(false);
  });
});

describe('withParticipant', () => {
  const root = m('r', 1, {
    thread: { title: null, replyCount: 1, lastReplyAt: null, participantIds: ['a'] },
  });
  it('adds a new replier once, up to five', () => {
    expect(withParticipant(root, 'b').thread!.participantIds).toEqual(['a', 'b']);
    expect(withParticipant(root, 'a')).toBe(root);
    const full = m('r', 1, {
      thread: {
        title: null,
        replyCount: 1,
        lastReplyAt: null,
        participantIds: ['1', '2', '3', '4', '5'],
      },
    });
    expect(withParticipant(full, '6')).toBe(full);
  });
});
