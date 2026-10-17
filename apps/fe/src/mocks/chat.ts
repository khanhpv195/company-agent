import type {
  Agent,
  Chat,
  ConnectInput,
  Message,
  MessageAuthor,
  Room,
  SendMessageInput,
  ToolCall,
} from '@repo/shared';
import { HttpError, type MockBackend } from './backend';
import { iso } from './fixtures';

const sleep = (b: MockBackend, ms: number) => new Promise<void>((resolve) => b.later(resolve, ms));
const preview = (markdown: string) => markdown.replace(/\*\*|`/g, '').split('\n')[0];

function lastOf(b: MockBackend, chatId: string) {
  const list = b.db.messages[chatId];
  return list?.[list.length - 1];
}

/** Rooms with previews and timestamps derived from their messages. */
export function listRooms(b: MockBackend): Room[] {
  return b.db.rooms.map((room) => {
    const threads = room.threads.map((t) => {
      const last = lastOf(b, t.id);
      return last ? { ...t, preview: preview(last.markdown), lastMessageAt: last.createdAt } : t;
    });
    const last = lastOf(b, room.id);
    return last
      ? { ...room, threads, preview: preview(last.markdown), lastMessageAt: last.createdAt }
      : { ...room, threads };
  });
}

export function findChat(b: MockBackend, chatId: string): Chat {
  const dm = b.db.rooms.find((r) => r.id === chatId && r.kind === 'dm');
  if (dm) {
    const agent = b.agent(dm.agentId);
    return {
      id: dm.id,
      kind: 'dm',
      title: agent?.name ?? dm.name,
      subtitle: null,
      agentIds: agent ? [agent.id] : [],
    };
  }
  for (const room of b.db.rooms) {
    const thread = room.threads.find((t) => t.id === chatId);
    if (thread) {
      const conn = b.db.connections.find((c) => c.id === thread.connectionId);
      const agentIds = conn?.agentId
        ? [conn.agentId]
        : b.db.agents.filter((a) => a.status !== 'offline').map((a) => a.id);
      return {
        id: thread.id,
        kind: 'thread',
        title: thread.name,
        subtitle: `# ${room.name}`,
        agentIds,
      };
    }
  }
  throw new HttpError(404, `Chat ${chatId} not found`);
}

export function markRead(b: MockBackend, chatId: string) {
  for (const room of b.db.rooms) for (const t of room.threads) if (t.id === chatId) t.unread = 0;
  b.emit({ type: 'rooms.changed' });
}

export function ensureDm(b: MockBackend, agentId: string): { chatId: string } {
  const agent = b.agent(agentId);
  if (!agent) throw new HttpError(404, 'Agent not found');
  const existing = b.db.rooms.find((r) => r.kind === 'dm' && r.agentId === agentId);
  if (existing) return { chatId: existing.id };
  const id = `dm-${agentId}`;
  b.db.rooms.unshift({
    id,
    kind: 'dm',
    name: agent.name,
    icon: 'users',
    isPrivate: true,
    agentId,
    lastMessageAt: iso(b.now()),
    preview: '',
    threads: [],
  });
  b.db.messages[id] = [];
  b.emit({ type: 'rooms.changed' });
  return { chatId: id };
}

function push(
  b: MockBackend,
  chatId: string,
  author: MessageAuthor,
  markdown: string,
  extra: Partial<Message> = {},
): Message {
  const m: Message = {
    id: b.nextId('m'),
    chatId,
    author,
    createdAt: iso(b.now()),
    status: 'complete',
    markdown,
    assignment: null,
    draft: null,
    ...extra,
  };
  (b.db.messages[chatId] ??= []).push(m);
  b.emit({ type: 'message.upserted', message: structuredClone(m) });
  b.emit({ type: 'rooms.changed' });
  return m;
}

export function sendMessage(b: MockBackend, chatId: string, input: SendMessageInput): Message {
  const text = input.markdown?.trim();
  if (!text) throw new HttpError(400, 'Message is empty');
  const chat = findChat(b, chatId);
  const m = push(b, chatId, { kind: 'human', id: b.db.meId }, text);
  const agents = chat.agentIds.map((id) => b.agent(id)).filter((a): a is Agent => !!a);
  const target =
    b.agent(input.agentId) ??
    agents.find((a) => text.includes('@' + a.name)) ??
    (chat.kind === 'dm' ? agents[0] : undefined);
  if (target) void runAssignment(b, chatId, target, text);
  return m;
}

function replyFor(text: string) {
  if (/sort|hàm|code|function/i.test(text))
    return 'Em viết hàm sort ổn định theo nhiều khoá, có test kèm theo:\n\n```ts\nexport function sortBy<T>(items: T[], ...keys: ((x: T) => string | number)[]) {\n  return [...items].sort((a, b) => {\n    for (const k of keys) {\n      const d = k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;\n      if (d) return d;\n    }\n    return 0;\n  });\n}\n```\n\nĐã chạy `pnpm test`: **4/4 pass**. Anh/chị muốn em commit vào nhánh mới không?';
  return 'Em đã xem qua repo và lịch sử gần đây. Tóm tắt nhanh:\n\n1. **apps/fe** là Tauri 2 + React 19, đã có UI workspace chạy trên mock.\n2. **apps/be** là NestJS 12 + TypeORM 1, healthcheck chạy ổn.\n3. Chưa có commit nào trên `main`.\n\nBước tiếp theo em đề xuất là làm API thật cho rooms và tasks. Anh/chị muốn em bắt đầu luôn không?';
}

/**
 * Mock assignment lifecycle: pending → offered → claimed → running, a couple of tool calls,
 * then the reply streams in small chunks and completes (or fails now and then).
 */
export async function runAssignment(b: MockBackend, chatId: string, agent: Agent, text: string) {
  const m = push(b, chatId, { kind: 'agent', id: agent.id }, '', {
    status: 'streaming',
    assignment: {
      id: b.nextId('as'),
      agentId: agent.id,
      status: 'pending',
      toolCalls: [],
      turns: 0,
      costUsd: null,
      error: null,
    },
  });
  const a = m.assignment!;
  const update = () => b.emit({ type: 'message.upserted', message: structuredClone(m) });
  /** The agent was deleted mid-reply: the open reply is cancelled and its message fails. */
  const cancelled = () => {
    if (b.agent(agent.id)) return false;
    a.status = 'cancelled';
    a.error = 'Agent đã bị xoá';
    m.status = 'failed';
    update();
    b.chatBusy.delete(agent.id);
    return true;
  };

  if (!b.isOnline(agent)) {
    await sleep(b, 1200);
    if (cancelled()) return;
    a.status = 'expired';
    a.error = `${b.computerOf(agent).name} offline, không có máy nhận việc`;
    m.status = 'failed';
    update();
    return;
  }

  for (const s of ['offered', 'claimed', 'running'] as const) {
    await sleep(b, 450);
    if (cancelled()) return;
    a.status = s;
    update();
  }
  b.chatBusy.add(agent.id);
  b.changed();

  const coding = /sort|hàm|code|function/i.test(text);
  const calls: [string, string, string][] = coding
    ? [
        ['Write', 'src/utils/sortBy.ts', 'Wrote 11 lines'],
        [
          'Bash',
          'pnpm test -- sortBy',
          '✓ sortBy › single key\n✓ sortBy › multi key\n✓ sortBy › stable\n✓ sortBy › empty\nTests: 4 passed',
        ],
      ]
    : [
        ['Bash', 'git log --oneline -5', '(no commits yet)'],
        ['Read', 'apps/fe/package.json', '"react": "^19.3.1", "vite": "^8.3.4" …'],
      ];
  for (const [name, input, output] of calls) {
    const call: ToolCall = { id: b.nextId('tc'), name, input, output, status: 'running' };
    a.toolCalls.push(call);
    update();
    await sleep(b, 900);
    if (cancelled()) return;
    call.status = 'ok';
    update();
  }

  const failed = b.random() < 0.08;
  if (failed) {
    a.status = 'failed';
    a.error = 'Claude Code thoát với mã 1 (context quá dài)';
    m.status = 'failed';
  } else {
    const full = replyFor(text);
    let shown = 0;
    while (shown < full.length) {
      shown = Math.min(full.length, shown + 3 + Math.floor(b.random() * 6));
      m.markdown = full.slice(0, shown);
      update();
      await sleep(b, 28);
      if (cancelled()) return;
    }
    a.status = 'completed';
    a.turns = 2;
    m.status = 'complete';
  }
  update();
  b.chatBusy.delete(agent.id);
  b.countRun(agent.id, !failed, 4);
  b.feed(
    agent.id,
    failed ? `thất bại khi trả lời **${preview(text)}**` : `trả lời **${preview(text)}**`,
  );
  b.db.agentActivity[agent.id]?.unshift({
    id: b.nextId('aa'),
    where:
      findChat(b, chatId).kind === 'dm'
        ? 'DM'
        : findChat(b, chatId).subtitle + ' › ' + findChat(b, chatId).title,
    request: preview(text),
    status: failed ? 'failed' : 'completed',
    at: iso(b.now()),
  });
  b.changed();
  b.emit({ type: 'rooms.changed' });
}

const SAMPLES: Record<string, { from: string; text: string; reply: string }> = {
  zalo: {
    from: 'Nguyễn Lan',
    text: 'Shop ơi áo polo size M còn màu trắng không ạ? Ship về Đà Nẵng mất mấy ngày?',
    reply:
      'Dạ chào chị Lan, áo polo size M màu trắng bên em **còn 6 chiếc** ạ. Ship về Đà Nẵng khoảng **2–3 ngày**, đơn từ 300k được miễn phí ship. Chị muốn em giữ hàng luôn không ạ?',
  },
  facebook: {
    from: 'Trần Huy',
    text: 'Cho mình hỏi gói Pro giá bao nhiêu, có dùng thử không?',
    reply:
      'Chào anh Huy, gói Pro là **$20/tháng** và có **14 ngày dùng thử miễn phí**, không cần thẻ. Em gửi anh link đăng ký nhé?',
  },
  gmail: {
    from: 'Phòng kế toán',
    text: '**Re: Hoá đơn tháng 9**\nAnh gửi giúp em bản xác nhận thanh toán AWS tháng 9 trước thứ Sáu nhé.',
    reply:
      'Em đã tìm thấy email hoá đơn AWS tháng 9 (**$412,80**) và soạn nháp trả lời kèm file PDF. Anh xem rồi bấm gửi giúp em.',
  },
};

function connection(b: MockBackend, id: string) {
  const c = b.db.connections.find((x) => x.id === id);
  if (!c) throw new HttpError(404, `Connection ${id} not found`);
  return c;
}

export function connect(b: MockBackend, id: string, input: ConnectInput) {
  const c = connection(b, id);
  if (!b.agent(input.agentId)) throw new HttpError(400, 'Unknown agent');
  const wasOn = c.status === 'on';
  c.status = 'on';
  c.account = input.account;
  c.agentId = input.agentId;
  c.mode = input.mode;
  c.roomName = input.roomName.trim().replace(/^#/, '') || `${c.id}-inbox`;
  const roomId = `${c.id}-room`;
  const threadId = `t-${c.id}`;
  const sample = SAMPLES[c.id];
  const existing = b.db.rooms.find((r) => r.id === roomId);
  if (existing) existing.name = c.roomName;
  else
    b.db.rooms.push({
      id: roomId,
      kind: 'channel',
      name: c.roomName,
      icon: 'inbox',
      isPrivate: false,
      agentId: null,
      lastMessageAt: iso(b.now()),
      preview: '',
      threads: [
        {
          id: threadId,
          roomId,
          name: sample.from,
          lastMessageAt: iso(b.now()),
          preview: '',
          unread: 2,
          connectionId: c.id,
        },
      ],
    });
  c.roomId = roomId;
  if (!wasOn) {
    b.db.messages[threadId] = [];
    push(b, threadId, { kind: 'external', connectionId: c.id, name: sample.from }, sample.text);
    push(b, threadId, { kind: 'agent', id: input.agentId }, sample.reply, {
      draft: { connectionId: c.id, state: c.mode === 'draft' ? 'pending' : 'sent' },
    });
    b.feed(b.db.meId, `kết nối **${c.name}** vào **#${c.roomName}**`);
  }
  b.emit({ type: 'connections.changed' });
  b.emit({ type: 'rooms.changed' });
  return c;
}

export function disconnect(b: MockBackend, id: string) {
  const c = connection(b, id);
  c.status = 'off';
  b.db.rooms = b.db.rooms.filter((r) => r.id !== c.roomId);
  delete b.db.messages[`t-${c.id}`];
  c.roomId = null;
  c.account = null;
  b.emit({ type: 'connections.changed' });
  b.emit({ type: 'rooms.changed' });
  return c;
}

export function sendDraft(b: MockBackend, messageId: string) {
  for (const list of Object.values(b.db.messages)) {
    const m = list.find((x) => x.id === messageId);
    if (m?.draft) {
      m.draft.state = 'sent';
      b.emit({ type: 'message.upserted', message: structuredClone(m) });
      return m;
    }
  }
  throw new HttpError(404, 'Draft not found');
}
