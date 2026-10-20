import type {
  Agent,
  AgentActivity,
  Computer,
  Connection,
  DashboardSummary,
  Department,
  Member,
  Message,
  MessageAuthor,
  PinItem,
  Room,
  RunSpan,
  SchedulerState,
  Skill,
  SkillVersion,
  Task,
  TaskActivity,
  TaskRun,
  Workspace,
} from '@repo/shared';
import { skillTemplateById } from '@repo/shared';

export interface MockDb {
  session: { loggedIn: boolean; onboarded: boolean };
  meId: string;
  workspace: Workspace;
  members: Member[];
  departments: Department[];
  computers: Computer[];
  agents: Agent[];
  /** The skill library (`agentIds` is derived from the agents on read). */
  skills: Skill[];
  /** Saved versions per skill id, newest first. */
  skillVersions: Record<string, SkillVersion[]>;
  rooms: Room[];
  /** Every message of a room (roots and thread replies), keyed by room id, in seq order. */
  messages: Record<string, Message[]>;
  /** Read cursors (message seq): key `roomId` for the main timeline, `roomId:rootId` for a thread. */
  reads: Record<string, number>;
  /** Muted rooms (`roomId`) and threads (`roomId:rootId`). */
  mutes: string[];
  pins: PinItem[];
  /** Channels the caller has left; they stay joinable when public. */
  leftRoomIds: string[];
  /** Per-room roster. Absent key = every workspace member and agent (the seeded rooms). */
  roster: Record<string, { memberIds: string[]; agentIds: string[] }>;
  tasks: Task[];
  spans: RunSpan[];
  taskSeq: number;
  idSeq: number;
  scheduler: SchedulerState;
  connections: Connection[];
  dashboard: DashboardSummary;
  agentActivity: Record<string, AgentActivity[]>;
  cliPolledAt: number | null;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const iso = (ms: number) => new Date(ms).toISOString();

export const PERSONA = `You are an agent on this workspace, an AI-native place where people and agents work together.

Be concise. Reply in the user's language. When you are mentioned in a room, read recent history before answering. Use tools when needed and report what you ran.`;

/** Library skills of the demo workspace: template id, creator and the agents that have it on. */
const DEMO_SKILLS: { template: string; by: string; agents: string[] }[] = [
  { template: 'bao-gia', by: 'u2', agents: [] },
  { template: 'tra-loi-khach', by: 'u2', agents: [] },
  { template: 'review-code', by: 'u3', agents: ['a1'] },
  { template: 'git', by: 'u3', agents: ['a1', 'a3'] },
  { template: 'viet-test', by: 'u3', agents: ['a1'] },
  { template: 'tom-tat', by: 'u1', agents: ['a1', 'a2'] },
  { template: 'nghien-cuu-web', by: 'u1', agents: ['a2'] },
  { template: 'dich', by: 'u1', agents: ['a2'] },
];

export function seed(now: number = Date.now()): MockDb {
  const T0 = now;
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  const ev = (
    by: string | null,
    text: string,
    at: number,
    tone: TaskActivity['tone'] = 'normal',
  ): TaskActivity => ({
    id: id('act'),
    by,
    at: iso(at),
    kind: 'event',
    text,
    tone,
  });
  const cm = (by: string, text: string, at: number): TaskActivity => ({
    id: id('act'),
    by,
    at: iso(at),
    kind: 'comment',
    text,
    tone: 'normal',
  });
  const run = (
    n: number,
    status: TaskRun['status'],
    durationSec: number,
    toolCalls: number,
    at: number,
    error: string | null = null,
  ): TaskRun => ({ n, status, durationSec, toolCalls, costUsd: null, at: iso(at), error });
  const subs = (...items: [string, number][]) =>
    items.map(([title, done]) => ({ title, done: !!done }));

  const members: Member[] = [
    {
      id: 'u1',
      name: 'khanhpv',
      email: 'khanhpv@holatech.tech',
      role: 'owner',
      color: null,
      departmentId: null,
      title: null,
    },
    {
      id: 'u2',
      name: 'Hằng',
      email: 'hang@holatech.tech',
      role: 'member',
      color: '#b0516f',
      departmentId: 'd-sales',
      title: 'Trưởng phòng Kinh doanh',
    },
    {
      id: 'u3',
      name: 'Minh',
      email: 'minh@holatech.tech',
      role: 'admin',
      color: '#3d8a6a',
      departmentId: 'd-eng',
      title: 'Kỹ sư trưởng',
    },
  ];

  // The demo departments have no channel yet (`roomId: null`); new ones get one.
  const departments: Department[] = [
    { id: 'd-sales', name: 'Kinh doanh', icon: 'chart', rank: 0, roomId: null },
    { id: 'd-eng', name: 'Kỹ thuật', icon: 'terminal', rank: 1, roomId: null },
  ];

  const computers: Computer[] = [
    {
      id: 'c1',
      name: 'khanhpv-MacBook-Pro',
      os: 'macOS 26.1 · arm64',
      status: 'online',
      lastHeartbeatAt: iso(T0 - 2000),
      keepAwake: true,
      cliVersion: '0.14.2',
      simulated: false,
      revokedAt: null,
    },
    {
      id: 'c2',
      name: 'build-box',
      os: 'Ubuntu 24.04 · x64',
      status: 'offline',
      lastHeartbeatAt: iso(T0 - 7240_000),
      keepAwake: false,
      cliVersion: '0.13.9',
      simulated: true,
      revokedAt: null,
    },
  ];

  const agents: Agent[] = [
    {
      id: 'a1',
      name: "khanhpv's Claude",
      avatar: 0,
      provider: 'claude-code',
      computerId: 'c1',
      persona: PERSONA,
      workdir: '~/.agent/agents/a1',
      maxTurns: 40,
      status: 'idle',
      simulated: false,
      departmentId: 'd-eng',
      title: 'Trợ lý kỹ thuật',
      skills: [],
    },
    {
      id: 'a2',
      name: 'Research Bot',
      avatar: 1,
      provider: 'claude-code',
      computerId: 'c1',
      persona: PERSONA,
      workdir: '~/.agent/agents/a2',
      maxTurns: 40,
      status: 'idle',
      simulated: false,
      departmentId: 'd-sales',
      title: 'Nghiên cứu thị trường',
      skills: [],
    },
    {
      id: 'a3',
      name: 'Deployer',
      avatar: 2,
      provider: 'claude-code',
      computerId: 'c2',
      persona: PERSONA,
      workdir: '/srv/agent/a3',
      maxTurns: 40,
      status: 'offline',
      simulated: true,
      departmentId: null,
      title: null,
      skills: [],
    },
  ];

  const skills: Skill[] = DEMO_SKILLS.map((d, i) => {
    const tpl = skillTemplateById(d.template)!;
    return {
      id: `sk-${tpl.id}`,
      slug: tpl.slug,
      name: tpl.name,
      description: tpl.description,
      content: tpl.content,
      templateId: tpl.id,
      version: 1,
      createdById: d.by,
      updatedById: d.by,
      updatedAt: iso(T0 - (i + 2) * 26 * HOUR),
      trusted: true,
      agentIds: [],
    };
  });
  const skillVersions: Record<string, SkillVersion[]> = Object.fromEntries(
    skills.map((k) => [
      k.id,
      [
        {
          version: 1,
          name: k.name,
          description: k.description,
          content: k.content,
          editedById: k.createdById,
          createdAt: k.updatedAt,
        },
      ],
    ]),
  );
  // Every agent lists the whole library (sorted by name) with its own flags.
  for (const a of agents)
    a.skills = [...skills]
      .sort((x, y) => x.name.localeCompare(y.name))
      .map((k) => ({
        id: k.id,
        name: k.name,
        enabled: !!DEMO_SKILLS.find((d) => `sk-${d.template}` === k.id)?.agents.includes(a.id),
      }));

  const room = (r: Partial<Room> & Pick<Room, 'id' | 'kind' | 'name' | 'icon'>): Room => ({
    isPrivate: false,
    agentId: null,
    lastMessageAt: iso(T0 - 23 * HOUR),
    preview: '',
    threads: [],
    ...r,
  });
  const rooms: Room[] = [
    room({ id: 'dm-a1', kind: 'dm', name: "khanhpv's Claude", icon: 'users', agentId: 'a1' }),
    room({ id: 'all', kind: 'channel', name: 'all-members', icon: 'users', isDefault: true }),
    room({
      id: 'welcome',
      kind: 'channel',
      name: 'welcome-khanhpv',
      icon: 'sparkles',
      isPrivate: true,
    }),
    room({
      id: 'test',
      kind: 'channel',
      name: 'test',
      icon: 'hourglass',
    }),
  ];

  const seqs: Record<string, number> = {};
  const msg = (
    roomId: string,
    author: MessageAuthor,
    markdown: string,
    at: number,
    extra: Partial<Message> = {},
    mid?: string,
  ): Message => ({
    id: mid ?? id('m'),
    chatId: roomId,
    roomId,
    parentId: null,
    seq: (seqs[roomId] = (seqs[roomId] ?? 0) + 1),
    reactions: [],
    author,
    createdAt: iso(at),
    status: 'complete',
    markdown,
    assignment: null,
    draft: null,
    ...extra,
  });
  const A = (aid: string): MessageAuthor => ({ kind: 'agent', id: aid });
  const U = (uid: string): MessageAuthor => ({ kind: 'human', id: uid });
  const t23 = T0 - 23 * HOUR;
  const messages: Record<string, Message[]> = {
    'dm-a1': [
      msg(
        'dm-a1',
        A('a1'),
        'Sáng nay có **3 email** cần chú ý, 2 pipeline GitLab failed và 1 MR chờ review.\n\nAnh/chị muốn em đào sâu cái nào: mở chi tiết email bảo mật, xem log pipeline failed, hay soạn trả lời cho MR trên GitLab?',
        t23 - 30 * MIN,
      ),
      msg('dm-a1', U('u1'), '@Hằng hello', t23 - 20 * MIN),
      msg(
        'dm-a1',
        A('a1'),
        'Hình như anh/chị đang muốn nhắc tới ai đó tên "Hằng", nhưng phòng này là DM riêng giữa anh/chị với em thôi. Không có thành viên nào tên Hằng ở đây, nên mention đó sẽ không tới được ai.\n\nNếu muốn nhắn cho Hằng, mình cần tạo một phòng chung có người đó, hoặc em gửi tin nhắn tới phòng khác giúp. Anh/chị muốn em làm cách nào?',
        t23 - 19 * MIN,
      ),
      msg('dm-a1', U('u1'), 'lam sao de toi metion Agent khac', t23 - 2 * MIN),
      msg(
        'dm-a1',
        A('a1'),
        'Để mention một Agent khác, điều kiện cốt lõi là: **Agent đó phải là thành viên cùng phòng với anh/chị.** Chỉ thành viên trong phòng mới nhận được mention.\n\nPhòng này là DM riêng (chỉ có anh/chị + em), nên không mention được ai khác ở đây. Hai cách làm:\n\n1. **Tạo một phòng chung** rồi thêm Agent đó vào, xong thì gõ `@` và chọn tên Agent từ danh sách gợi ý, nó sẽ được "đánh thức" để trả lời.\n2. Nếu anh/chị cho em biết **tên hoặc ID của Agent** muốn gọi, em tra trong workspace xem có Agent đó không, rồi tạo phòng và thêm vào giúp.\n\nAnh/chị muốn gọi Agent nào? Cho em tên là em lo phần còn lại.',
        t23,
      ),
    ],
    test: [
      msg(
        'test',
        U('u1'),
        'Hello @Research Bot',
        t23 - 1 * MIN,
        { threadTitle: 'Hello' },
        't-hello',
      ),
      msg(
        'test',
        A('a2'),
        'Chào khanhpv! Research Bot đã sẵn sàng. Gửi em một chủ đề, em sẽ tìm và tóm tắt nguồn cho anh/chị.',
        t23,
        { parentId: 't-hello' },
      ),
    ],
  };

  // Everything starts read.
  const reads: Record<string, number> = {};
  for (const [roomId, list] of Object.entries(messages)) {
    reads[roomId] = Math.max(0, ...list.filter((m) => !m.parentId).map((m) => m.seq ?? 0));
    for (const root of list.filter((m) => list.some((x) => x.parentId === m.id)))
      reads[`${roomId}:${root.id}`] = Math.max(
        ...list.filter((m) => m.id === root.id || m.parentId === root.id).map((m) => m.seq ?? 0),
      );
  }

  const task = (
    t: Partial<Task> &
      Pick<
        Task,
        | 'id'
        | 'title'
        | 'status'
        | 'assigneeId'
        | 'priority'
        | 'labels'
        | 'chatId'
        | 'requiresReview'
        | 'createdAt'
        | 'activity'
      >,
  ): Task => ({
    // Fresh arrays per task: shared defaults would leak runs between tasks.
    description: '',
    subtasks: [],
    runs: [],
    activeRun: null,
    output: null,
    blockedReason: null,
    error: null,
    rank: 0,
    ...t,
  });

  const tasks: Task[] = [
    task({
      id: 'AG-31',
      title: 'Tóm tắt email sáng nay và gắn nhãn',
      status: 'doing',
      assigneeId: 'a1',
      priority: 'high',
      labels: ['email'],
      chatId: 'dm-a1',
      requiresReview: false,
      createdAt: iso(T0 - 40 * MIN),
      description:
        'Lọc email chưa đọc từ 18h hôm qua, gắn nhãn **Cần xử lý** cho thư khẩn, gửi bản tóm tắt vào DM.',
      subtasks: subs(['Lọc thư chưa đọc', 1], ['Gắn nhãn thư khẩn', 0], ['Gửi tóm tắt vào DM', 0]),
      activeRun: { n: 1, startedAt: iso(T0 - 74_000), step: 2, steps: [], computerId: 'c1' },
      activity: [
        ev('u1', 'tạo task', T0 - 40 * MIN),
        ev('a1', 'nhận task, bắt đầu run #1', T0 - 74_000),
      ],
    }),
    task({
      id: 'AG-30',
      title: 'Tìm 5 đối thủ cùng ngành, so sánh bảng giá',
      status: 'doing',
      assigneeId: 'a2',
      priority: 'med',
      labels: ['research'],
      chatId: 't-hello',
      requiresReview: true,
      createdAt: iso(T0 - 25 * MIN),
      description:
        'Lấy bảng giá công khai của 5 đối thủ, so theo gói và tính năng. Xuất `pricing.csv` + 1 trang nhận xét.',
      subtasks: subs(['Danh sách 5 đối thủ', 0], ['Bảng so sánh', 0], ['Nhận xét ngắn', 0]),
      activeRun: { n: 1, startedAt: iso(T0 - 9000), step: 0, steps: [], computerId: 'c1' },
      activity: [
        ev('u3', 'tạo task', T0 - 25 * MIN),
        ev('a2', 'nhận task, bắt đầu run #1', T0 - 9000),
      ],
    }),
    task({
      id: 'AG-23',
      title: 'Phác thảo màn Tasks cho desktop app',
      status: 'doing',
      assigneeId: 'u1',
      priority: 'med',
      labels: ['fe'],
      chatId: null,
      requiresReview: false,
      createdAt: iso(T0 - 26 * HOUR),
      description: 'Board + view theo agent để admin biết agent nào đang làm gì.',
      subtasks: subs(['Board', 1], ['Danh sách', 1], ['Theo Agent', 0]),
      activity: [ev('u1', 'tạo task', T0 - 26 * HOUR)],
    }),
    task({
      id: 'AG-29',
      title: 'Trả lời khách hỏi giá combo 3 tháng (Zalo)',
      status: 'review',
      assigneeId: 'a1',
      priority: 'high',
      labels: ['zalo'],
      chatId: 'dm-a1',
      requiresReview: true,
      createdAt: iso(T0 - 14 * MIN),
      description: 'Chị Lan (Zalo OA) hỏi giá combo 3 tháng và phí ship.',
      subtasks: subs(['Đọc tin khách', 1], ['Tra bảng giá', 1], ['Soạn nháp', 1]),
      output:
        'Dạ chào chị Lan, combo 3 tháng hiện giá **1.290.000đ**, đã gồm phí ship nội thành ạ. Chị muốn em giữ suất cho mình không ạ?',
      runs: [run(1, 'completed', 48, 3, T0 - 12 * MIN)],
      activity: [
        ev('a1', 'tạo task từ tin Zalo', T0 - 14 * MIN),
        ev('a1', 'xong run #1, chuyển sang **Chờ duyệt**', T0 - 12 * MIN),
      ],
    }),
    task({
      id: 'AG-28',
      title: 'Viết hàm sortBy nhiều khoá + test',
      status: 'review',
      assigneeId: 'a1',
      priority: 'med',
      labels: ['fe'],
      chatId: 'dm-a1',
      requiresReview: true,
      createdAt: iso(T0 - 50 * MIN),
      description: 'Hàm sort ổn định theo nhiều khoá cho bảng Computers.',
      subtasks: subs(['Viết hàm', 1], ['Viết test', 1]),
      output:
        'Đã thêm `src/utils/sortBy.ts` và 4 test, `pnpm test` **4/4 pass**. Nhánh `feat/sort-by` sẵn sàng mở MR.',
      runs: [run(1, 'completed', 96, 5, T0 - 35 * MIN)],
      activity: [
        ev('u1', 'tạo task', T0 - 50 * MIN),
        ev('a1', 'xong run #1, chuyển sang **Chờ duyệt**', T0 - 35 * MIN),
      ],
    }),
    task({
      id: 'AG-27',
      title: 'Deploy staging sau khi nâng cấp NestJS 12',
      status: 'todo',
      assigneeId: 'a3',
      priority: 'urgent',
      labels: ['infra'],
      chatId: 'all',
      requiresReview: false,
      createdAt: iso(T0 - 50 * HOUR),
      blockedReason: 'build-box offline',
      description: 'Build image `be` mới, chạy migration rồi `up -d` trên staging.',
      subtasks: subs(['Build image', 0], ['Migration', 0], ['Health check', 0]),
      runs: [run(1, 'failed', 212, 6, T0 - 48 * HOUR, 'migration:run exit 1')],
      activity: [
        ev('u3', 'tạo task', T0 - 50 * HOUR),
        ev('a3', 'run #1 thất bại ở `migration:run`', T0 - 48 * HOUR, 'error'),
        cm(
          'u3',
          'Lần trước fail ở bước migration, nhớ chạy `migration:run` trước khi `up`.',
          T0 - 47 * HOUR,
        ),
      ],
    }),
    task({
      id: 'AG-26',
      title: 'Review MR !42: thêm module computers',
      status: 'todo',
      assigneeId: 'a1',
      priority: 'high',
      labels: ['be'],
      chatId: 'dm-a1',
      requiresReview: true,
      createdAt: iso(T0 - 76 * HOUR),
      description: 'Đọc diff, chạy test, ghi nhận xét vào MR.',
      subtasks: subs(['Đọc diff', 0], ['Chạy test', 0], ['Viết nhận xét', 0]),
      runs: [run(1, 'expired', 0, 0, T0 - 72 * HOUR)],
      activity: [
        ev('u1', 'tạo task', T0 - 76 * HOUR),
        ev('a1', 'hết hạn lease, trả lại hàng đợi', T0 - 72 * HOUR),
      ],
    }),
    task({
      id: 'AG-25',
      title: 'Viết docs API cho /computers',
      status: 'todo',
      assigneeId: 'a1',
      priority: 'low',
      labels: ['docs'],
      chatId: 'dm-a1',
      requiresReview: true,
      createdAt: iso(T0 - 5 * HOUR),
      description: 'Mô tả các endpoint, ví dụ request/response.',
      activity: [ev('u3', 'tạo task', T0 - 5 * HOUR)],
    }),
    task({
      id: 'AG-24',
      title: 'Chuẩn hoá data khách hàng trong Sheet',
      status: 'todo',
      assigneeId: 'a2',
      priority: 'med',
      labels: ['data'],
      chatId: 't-hello',
      requiresReview: true,
      createdAt: iso(T0 - 3 * HOUR),
      description: 'Chuẩn hoá số điện thoại, email; gộp dòng trùng.',
      subtasks: subs(['Chuẩn hoá', 0], ['Gộp trùng', 0]),
      activity: [ev('u2', 'tạo task', T0 - 3 * HOUR)],
    }),
    task({
      id: 'AG-22',
      title: 'Chuyển migrations sang TypeORM 1',
      status: 'backlog',
      assigneeId: null,
      priority: 'med',
      labels: ['be'],
      chatId: null,
      requiresReview: true,
      createdAt: iso(T0 - 30 * HOUR),
      activity: [ev('u3', 'tạo task', T0 - 30 * HOUR)],
    }),
    task({
      id: 'AG-21',
      title: 'Kết nối Telegram cho kênh CSKH',
      status: 'backlog',
      assigneeId: null,
      priority: 'low',
      labels: ['zalo'],
      chatId: null,
      requiresReview: false,
      createdAt: iso(T0 - 28 * HOUR),
      activity: [ev('u1', 'tạo task', T0 - 28 * HOUR)],
    }),
    task({
      id: 'AG-20',
      title: 'Báo cáo tuần gửi ban giám đốc',
      status: 'backlog',
      assigneeId: 'u3',
      priority: 'med',
      labels: ['docs'],
      chatId: null,
      requiresReview: false,
      createdAt: iso(T0 - 20 * HOUR),
      activity: [ev('u3', 'tạo task', T0 - 20 * HOUR)],
    }),
    task({
      id: 'AG-19',
      title: 'Nâng cấp NestJS 12 + TypeORM 1',
      status: 'done',
      assigneeId: 'a1',
      priority: 'high',
      labels: ['be'],
      chatId: 'dm-a1',
      requiresReview: true,
      createdAt: iso(T0 - 30 * HOUR),
      output: 'Đã nâng cấp, 9/9 test BE pass.',
      runs: [run(1, 'completed', 1260, 38, T0 - 25 * HOUR)],
      activity: [ev('u1', 'duyệt kết quả, chuyển sang **Xong**', T0 - 24 * HOUR)],
    }),
    task({
      id: 'AG-18',
      title: 'Cài Rust toolchain cho Tauri',
      status: 'done',
      assigneeId: 'a1',
      priority: 'med',
      labels: ['infra'],
      chatId: 'dm-a1',
      requiresReview: false,
      createdAt: iso(T0 - 26 * HOUR),
      runs: [run(1, 'completed', 140, 4, T0 - 25 * HOUR)],
      activity: [],
    }),
    task({
      id: 'AG-17',
      title: 'Dịch landing page sang tiếng Anh',
      status: 'done',
      assigneeId: 'a2',
      priority: 'low',
      labels: ['docs'],
      chatId: 't-hello',
      requiresReview: true,
      createdAt: iso(T0 - 7 * HOUR),
      runs: [run(1, 'completed', 310, 7, T0 - 6 * HOUR)],
      activity: [],
    }),
    task({
      id: 'AG-16',
      title: 'Crawl giá đối thủ (lần 1)',
      status: 'done',
      assigneeId: 'a2',
      priority: 'med',
      labels: ['research'],
      chatId: 't-hello',
      requiresReview: false,
      createdAt: iso(T0 - 7 * HOUR),
      runs: [
        run(2, 'completed', 1200, 6, T0 - 5 * HOUR),
        run(1, 'failed', 360, 2, T0 - 5.5 * HOUR, 'WebFetch 403'),
      ],
      activity: [],
    }),
    task({
      id: 'AG-15',
      title: 'Dọn nhãn Gmail cũ',
      status: 'done',
      assigneeId: 'a1',
      priority: 'low',
      labels: ['email'],
      chatId: 'dm-a1',
      requiresReview: false,
      createdAt: iso(T0 - 3 * HOUR),
      runs: [run(1, 'completed', 720, 3, T0 - 150 * MIN)],
      activity: [],
    }),
  ];
  tasks.forEach((t, i) => (t.rank = i));

  const span = (
    agentId: string,
    agoMin: number,
    lenMin: number,
    result: RunSpan['result'],
    title: string,
  ): RunSpan => ({
    agentId,
    title,
    startedAt: iso(T0 - agoMin * MIN),
    endedAt: iso(T0 - (agoMin - lenMin) * MIN),
    result,
  });
  const spans: RunSpan[] = [
    span('a1', 462, 22, 'done', 'Đồng bộ lịch họp tuần'),
    span('a1', 428, 9, 'done', 'Tóm tắt Slack #dev'),
    span('a1', 392, 34, 'done', 'Viết test cho api-client'),
    span('a1', 318, 14, 'fail', 'Deploy preview'),
    span('a1', 300, 18, 'done', 'Deploy preview (lần 2)'),
    span('a1', 238, 41, 'done', 'Refactor TodoPage'),
    span('a1', 162, 12, 'done', 'Dọn nhãn Gmail cũ'),
    span('a1', 37, 2, 'done', 'Viết hàm sortBy nhiều khoá + test'),
    span('a1', 13, 1, 'done', 'Trả lời khách hỏi giá combo (Zalo)'),
    span('a2', 448, 30, 'done', 'Tóm tắt 3 bài báo thị trường'),
    span('a2', 366, 6, 'fail', 'Crawl giá đối thủ (lần 1)'),
    span('a2', 354, 20, 'done', 'Crawl giá đối thủ (lần 2)'),
    span('a2', 330, 24, 'done', 'Dịch landing page sang tiếng Anh'),
    span('a2', 206, 45, 'done', 'Nghiên cứu Zalo OA API'),
    span('a2', 96, 15, 'done', 'Tóm tắt PDF hợp đồng'),
    span('a3', 470, 12, 'done', 'Build image be'),
    span('a3', 452, 9, 'fail', 'Deploy staging'),
  ];

  const connections: Connection[] = [
    {
      id: 'zalo',
      name: 'Zalo OA',
      shortName: 'Zalo',
      color: '#0068ff',
      status: 'off',
      availability: 'simulated',
      roomName: 'zalo-inbox',
      description:
        'Nhận tin nhắn gửi tới Official Account. Agent đọc, soạn trả lời và gửi lại khách trên Zalo.',
      capabilities: ['Tin nhắn OA', 'Trả lời khách', 'Người quan tâm'],
      permissions: [
        'Đọc tin nhắn gửi tới Official Account',
        'Gửi tin nhắn trả lời thay OA',
        'Xem tên và ảnh đại diện người quan tâm',
      ],
      accountLabel: 'Official Account',
      accounts: [
        { name: 'Holatech OA', detail: '1.240 người quan tâm' },
        { name: 'Hola Shop', detail: '386 người quan tâm' },
      ],
      account: null,
      roomId: null,
      agentId: null,
      mode: 'draft',
    },
    {
      id: 'facebook',
      name: 'Facebook Messenger',
      shortName: 'Facebook',
      color: '#1877f2',
      status: 'off',
      availability: 'simulated',
      roomName: 'facebook-inbox',
      description: 'Nối Fanpage để agent xử lý inbox Messenger và comment dưới bài viết.',
      capabilities: ['Messenger', 'Comment', 'Trả lời khách'],
      permissions: [
        'Đọc tin nhắn Messenger của Page',
        'Trả lời tin nhắn và comment',
        'Xem thông tin công khai của Page',
      ],
      accountLabel: 'Fanpage',
      accounts: [
        { name: 'Holatech', detail: 'Page · 5,2K người theo dõi' },
        { name: 'Hola Shop', detail: 'Page · 820 người theo dõi' },
      ],
      account: null,
      roomId: null,
      agentId: null,
      mode: 'draft',
    },
    {
      id: 'gmail',
      name: 'Gmail',
      shortName: 'Google',
      color: '#ea4335',
      status: 'off',
      availability: 'simulated',
      roomName: 'gmail-inbox',
      description:
        'Agent đọc email mới, tóm tắt, gắn nhãn và soạn nháp trả lời. Chỉ gửi khi bạn cho phép.',
      capabilities: ['Đọc email', 'Soạn nháp', 'Gửi', 'Nhãn'],
      permissions: [
        'Đọc email trong hộp thư đến',
        'Tạo bản nháp trả lời',
        'Gửi email khi bạn cho phép',
        'Thêm và gỡ nhãn',
      ],
      accountLabel: 'hộp thư',
      accounts: [{ name: 'khanhpv@holatech.tech', detail: 'Google Workspace' }],
      account: null,
      roomId: null,
      agentId: null,
      mode: 'draft',
    },
  ];

  const done = [6, 9, 7, 11, 8, 4, 3, 10, 12, 9, 14, 11, 10, 13];
  const fail = [1, 0, 2, 1, 0, 0, 1, 1, 0, 2, 1, 0, 1, 1];
  const dashboard: DashboardSummary = {
    days: done.map((completed, i) => {
      const d = new Date(T0);
      d.setDate(d.getDate() - (done.length - 1 - i));
      return { date: iso(d.getTime()), completed, failed: fail[i] };
    }),
    byAgent: [
      { agentId: 'a1', count: 55 },
      { agentId: 'a2', count: 24 },
      { agentId: 'a3', count: 6 },
    ],
    minutesToday: 38,
    attention: [
      {
        id: 'att-1',
        kind: 'error',
        title: 'deploy staging thất bại',
        meta: 'Deployer · #all-members · 2 ngày trước',
        action: 'Chạy lại',
        taskId: 'AG-27',
        resolved: false,
      },
      {
        id: 'att-2',
        kind: 'warning',
        title: 'review MR !42 hết hạn lease',
        meta: "khanhpv's Claude · DM · 3 ngày trước",
        action: 'Giao lại',
        taskId: 'AG-26',
        resolved: false,
      },
      {
        id: 'att-3',
        kind: 'offline',
        title: 'build-box offline 2 giờ',
        meta: 'Deployer không nhận được việc mới',
        action: 'Hướng dẫn',
        taskId: null,
        resolved: false,
      },
    ],
    feed: [
      { id: 'f1', by: 'a1', text: 'trả lời **cách mention agent khác**', at: iso(T0 - 23 * HOUR) },
      { id: 'f2', by: 'a2', text: 'chào bạn trong **#test › Hello**', at: iso(T0 - 23 * HOUR) },
      { id: 'f3', by: 'u3', text: 'tham gia workspace', at: iso(T0 - 26 * HOUR) },
      { id: 'f4', by: 'a3', text: 'thất bại ở **deploy staging**', at: iso(T0 - 48 * HOUR) },
      { id: 'f5', by: 'u1', text: 'kết nối máy **khanhpv-MacBook-Pro**', at: iso(T0 - 72 * HOUR) },
    ],
  };

  const act = (
    where: string,
    request: string,
    status: AgentActivity['status'],
    agoH: number,
  ): AgentActivity => ({
    id: id('aa'),
    where,
    request,
    status,
    at: iso(T0 - agoH * HOUR),
  });
  const agentActivity: Record<string, AgentActivity[]> = {
    a1: [
      act('DM', 'lam sao de toi metion Agent khac', 'completed', 23),
      act('DM', 'tóm tắt email sáng nay', 'completed', 26),
      act('DM', 'review MR !42', 'expired', 72),
    ],
    a2: [
      act('#test › Hello', 'Hello', 'completed', 23),
      act('#test › Hello', 'Crawl giá đối thủ', 'failed', 6),
    ],
    a3: [act('#all-members', 'deploy staging', 'failed', 48)],
  };

  return {
    session: { loggedIn: false, onboarded: false },
    meId: 'u1',
    workspace: { id: 'w1', name: 'khanhpv workspace', slug: 'khanhpv', plan: 'free' },
    members,
    departments,
    computers,
    agents,
    skills,
    skillVersions,
    rooms,
    messages,
    reads,
    mutes: [],
    pins: [],
    leftRoomIds: [],
    roster: {},
    tasks,
    spans,
    taskSeq: 31,
    idSeq: n,
    scheduler: { paused: false },
    connections,
    dashboard,
    agentActivity,
    cliPolledAt: null,
  };
}
