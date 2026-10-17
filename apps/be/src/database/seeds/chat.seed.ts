import { Logger } from '@nestjs/common';
import type { RoomIcon } from '@repo/shared';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { ensureDmRoom } from '../../modules/chat/dm-room';
import { ChatMessage } from '../../modules/chat/entities/chat-message.entity';
import { Room } from '../../modules/chat/entities/room.entity';
import { Thread } from '../../modules/chat/entities/thread.entity';
import { TaskEntity } from '../../modules/tasks/entities/task.entity';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const MIN = 60_000;
const HOUR = 60 * MIN;

type Who = 'u1' | 'a1' | 'a2';
interface MessageSeed {
  by: Who;
  markdown: string;
  /** Minutes before the base time (23 h ago). */
  beforeMin: number;
}

/** Port of the FE mock fixtures (apps/fe/src/mocks/fixtures.ts): rooms, DM and thread chats. */
const DM_MESSAGES: MessageSeed[] = [
  {
    by: 'a1',
    beforeMin: 30,
    markdown:
      'Sáng nay có **3 email** cần chú ý, 2 pipeline GitLab failed và 1 MR chờ review.\n\nAnh/chị muốn em đào sâu cái nào: mở chi tiết email bảo mật, xem log pipeline failed, hay soạn trả lời cho MR trên GitLab?',
  },
  { by: 'u1', beforeMin: 20, markdown: '@Hằng hello' },
  {
    by: 'a1',
    beforeMin: 19,
    markdown:
      'Hình như anh/chị đang muốn nhắc tới ai đó tên "Hằng", nhưng phòng này là DM riêng giữa anh/chị với em thôi. Không có thành viên nào tên Hằng ở đây, nên mention đó sẽ không tới được ai.\n\nNếu muốn nhắn cho Hằng, mình cần tạo một phòng chung có người đó, hoặc em gửi tin nhắn tới phòng khác giúp. Anh/chị muốn em làm cách nào?',
  },
  { by: 'u1', beforeMin: 2, markdown: 'lam sao de toi metion Agent khac' },
  {
    by: 'a1',
    beforeMin: 0,
    markdown:
      'Để mention một Agent khác, điều kiện cốt lõi là: **Agent đó phải là thành viên cùng phòng với anh/chị.** Chỉ thành viên trong phòng mới nhận được mention.\n\nPhòng này là DM riêng (chỉ có anh/chị + em), nên không mention được ai khác ở đây. Hai cách làm:\n\n1. **Tạo một phòng chung** rồi thêm Agent đó vào, xong thì gõ `@` và chọn tên Agent từ danh sách gợi ý, nó sẽ được "đánh thức" để trả lời.\n2. Nếu anh/chị cho em biết **tên hoặc ID của Agent** muốn gọi, em tra trong workspace xem có Agent đó không, rồi tạo phòng và thêm vào giúp.\n\nAnh/chị muốn gọi Agent nào? Cho em tên là em lo phần còn lại.',
  },
];

const THREAD_MESSAGES: MessageSeed[] = [
  { by: 'u1', beforeMin: 1, markdown: 'Hello @Research Bot' },
  {
    by: 'a2',
    beforeMin: 0,
    markdown:
      'Chào khanhpv! Research Bot đã sẵn sàng. Gửi em một chủ đề, em sẽ tìm và tóm tắt nguồn cho anh/chị.',
  },
];

const CHANNELS: { name: string; icon: RoomIcon; isPrivate: boolean; thread?: string }[] = [
  { name: 'all-members', icon: 'users', isPrivate: false },
  { name: 'welcome-khanhpv', icon: 'sparkles', isPrivate: true },
  { name: 'test', icon: 'hourglass', isPrivate: false, thread: 'Hello' },
];

/** The seeded tasks' conversations: assigned to a1 -> its DM, Research Bot's -> the Hello thread. */
const DM_TASKS = ['AG-31', 'AG-29', 'AG-28', 'AG-26', 'AG-25', 'AG-19', 'AG-18', 'AG-15'];
const THREAD_TASKS = ['AG-30', 'AG-24', 'AG-17', 'AG-16'];

const need = <T>(value: T | undefined, what: string): T => {
  if (!value)
    throw new Error(`Seed:chat needs ${what}; run the auth, agents and tasks seeds first`);
  return value;
};

/**
 * Creates the rooms, DM, threads and messages of the `khanhpv` workspace and links the seeded
 * tasks to their chats. Idempotent: rooms are matched by name, messages are only inserted into
 * an empty chat, and tasks only get a chat when they have none.
 */
export const seedChat = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:chat');
  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    await seedChatFor(manager, workspace.id, Date.now(), logger);
  });
};

const seedChatFor = async (
  manager: EntityManager,
  workspaceId: string,
  now: number,
  logger: Logger,
): Promise<void> => {
  const agents = await manager.find(Agent, { where: { workspaceId } });
  const members = await manager.find(Member, { where: { workspaceId } });
  const actor: Record<Who, string> = {
    u1: need(members.find((m) => m.email === 'khanhpv@holatech.tech')?.id, 'member khanhpv'),
    a1: need(agents.find((a) => a.name === "khanhpv's Claude")?.id, "agent khanhpv's Claude"),
    a2: need(agents.find((a) => a.name === 'Research Bot')?.id, 'agent Research Bot'),
  };
  const base = now - 23 * HOUR;
  const createdAt = (offset: number) => new Date(now - 24 * HOUR + offset * MIN);

  const insertMessages = async (chatId: string, chatKind: 'dm' | 'thread', list: MessageSeed[]) => {
    if (await manager.exists(ChatMessage, { where: { workspaceId, chatId } })) return false;
    for (const m of list) {
      await manager.insert(ChatMessage, {
        workspaceId,
        chatId,
        chatKind,
        authorKind: m.by === 'u1' ? 'human' : 'agent',
        authorMemberId: m.by === 'u1' ? actor.u1 : null,
        authorAgentId: m.by === 'u1' ? null : actor[m.by],
        status: 'complete',
        markdown: m.markdown,
        draft: null,
        createdAt: new Date(base - m.beforeMin * MIN),
      });
    }
    return true;
  };

  const dm = await ensureDmRoom(manager, {
    workspaceId,
    memberId: actor.u1,
    agent: { id: actor.a1, name: "khanhpv's Claude" },
    now: createdAt(0),
  });
  if (dm.created) logger.log("Created DM with khanhpv's Claude");
  await insertMessages(dm.id, 'dm', DM_MESSAGES);

  let helloThreadId: string | null = null;
  for (const [i, channel] of CHANNELS.entries()) {
    let room = await manager.findOne(Room, {
      where: { workspaceId, kind: 'channel', name: channel.name },
    });
    if (!room) {
      room = await manager.save(
        manager.create(Room, {
          workspaceId,
          kind: 'channel',
          name: channel.name,
          icon: channel.icon,
          isPrivate: channel.isPrivate,
          agentId: null,
          memberId: null,
          connectionId: null,
          createdAt: createdAt(i + 1),
        }),
      );
      logger.log(`Created room #${channel.name}`);
    }
    if (!channel.thread) continue;
    let thread = await manager.findOne(Thread, {
      where: { workspaceId, roomId: room.id, name: channel.thread },
    });
    if (!thread) {
      thread = await manager.save(
        manager.create(Thread, {
          workspaceId,
          roomId: room.id,
          name: channel.thread,
          connectionId: null,
          createdAt: createdAt(i + 1),
        }),
      );
    }
    helloThreadId = thread.id;
    if (await insertMessages(thread.id, 'thread', THREAD_MESSAGES)) {
      // As in the mock fixtures, khanhpv has already read the thread (unread 0).
      await manager.query(
        `INSERT INTO thread_reads (member_id, chat_id, last_read_at) VALUES ($1, $2, $3)
         ON CONFLICT (member_id, chat_id) DO NOTHING`,
        [actor.u1, thread.id, new Date(now)],
      );
    }
  }

  for (const [chatId, ids] of [
    [dm.id, DM_TASKS],
    [helloThreadId, THREAD_TASKS],
  ] as const) {
    if (chatId) {
      await manager.update(
        TaskEntity,
        { workspaceId, id: In([...ids]), chatId: IsNull() },
        { chatId },
      );
    }
  }
};
