import { Logger } from '@nestjs/common';
import {
  stepsFor,
  type TaskPriority,
  type TaskRunStatus,
  type TaskStatus,
  type TaskSubtask,
} from '@repo/shared';
import type { DataSource, EntityManager } from 'typeorm';
import { LEASE_MS } from '../../contacts';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { Assignment } from '../../modules/gateway/entities/assignment.entity';
import { TaskActivityRow } from '../../modules/tasks/entities/task-activity.entity';
import { TaskRun } from '../../modules/tasks/entities/task-run.entity';
import { TaskEntity } from '../../modules/tasks/entities/task.entity';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Keys of the FE mock fixtures: agents a1..a3 and members u1..u3. */
export type AgentKey = 'a1' | 'a2' | 'a3';
export type MemberKey = 'u1' | 'u2' | 'u3';
type ActorKey = AgentKey | MemberKey;

export interface TaskSeedWorld {
  workspaceId: string;
  agents: Record<AgentKey, string>;
  members: Record<MemberKey, string>;
  /** "Now" for every relative time below. */
  now: number;
}

interface RunSeed {
  n: number;
  status: TaskRunStatus;
  durationSec: number;
  toolCalls: number;
  /** How long before "now" the run ended. */
  agoMs: number;
  error?: string;
}

interface ActivitySeed {
  by: ActorKey | null;
  text: string;
  agoMs: number;
  tone?: 'normal' | 'error';
  kind?: 'event' | 'comment';
}

interface TaskSeed {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: ActorKey | null;
  priority: TaskPriority;
  labels: string[];
  requiresReview: boolean;
  createdAgoMs: number;
  description?: string;
  subtasks?: TaskSubtask[];
  output?: string;
  blockedReason?: string;
  runs?: RunSeed[];
  /** The run in progress: a `running` assignment with a fresh lease (the simulator continues it). */
  active?: { n: number; startedAgoMs: number; step: number };
  activity: ActivitySeed[];
}

const subs = (...items: [string, number][]): TaskSubtask[] =>
  items.map(([title, done]) => ({ title, done: !!done }));
const ev = (
  by: ActorKey | null,
  text: string,
  agoMs: number,
  tone: 'normal' | 'error' = 'normal',
): ActivitySeed => ({ by, text, agoMs, tone });
const cm = (by: ActorKey, text: string, agoMs: number): ActivitySeed => ({
  by,
  text,
  agoMs,
  kind: 'comment',
});
const run = (
  n: number,
  status: TaskRunStatus,
  durationSec: number,
  toolCalls: number,
  agoMs: number,
  error?: string,
): RunSeed => ({ n, status, durationSec, toolCalls, agoMs, error });

/** Port of the FE mock fixture tasks (apps/fe/src/mocks/fixtures.ts), in board order. */
export const TASK_SEEDS: TaskSeed[] = [
  {
    id: 'AG-31',
    title: 'Tóm tắt email sáng nay và gắn nhãn',
    status: 'doing',
    assignee: 'a1',
    priority: 'high',
    labels: ['email'],
    requiresReview: false,
    createdAgoMs: 40 * MIN,
    description:
      'Lọc email chưa đọc từ 18h hôm qua, gắn nhãn **Cần xử lý** cho thư khẩn, gửi bản tóm tắt vào DM.',
    subtasks: subs(['Lọc thư chưa đọc', 1], ['Gắn nhãn thư khẩn', 0], ['Gửi tóm tắt vào DM', 0]),
    active: { n: 1, startedAgoMs: 74_000, step: 2 },
    activity: [ev('u1', 'tạo task', 40 * MIN), ev('a1', 'nhận task, bắt đầu run #1', 74_000)],
  },
  {
    id: 'AG-30',
    title: 'Tìm 5 đối thủ cùng ngành, so sánh bảng giá',
    status: 'doing',
    assignee: 'a2',
    priority: 'med',
    labels: ['research'],
    requiresReview: true,
    createdAgoMs: 25 * MIN,
    description:
      'Lấy bảng giá công khai của 5 đối thủ, so theo gói và tính năng. Xuất `pricing.csv` + 1 trang nhận xét.',
    subtasks: subs(['Danh sách 5 đối thủ', 0], ['Bảng so sánh', 0], ['Nhận xét ngắn', 0]),
    active: { n: 1, startedAgoMs: 9_000, step: 0 },
    activity: [ev('u3', 'tạo task', 25 * MIN), ev('a2', 'nhận task, bắt đầu run #1', 9_000)],
  },
  {
    id: 'AG-23',
    title: 'Phác thảo màn Tasks cho desktop app',
    status: 'doing',
    assignee: 'u1',
    priority: 'med',
    labels: ['fe'],
    requiresReview: false,
    createdAgoMs: 26 * HOUR,
    description: 'Board + view theo agent để admin biết agent nào đang làm gì.',
    subtasks: subs(['Board', 1], ['Danh sách', 1], ['Theo Agent', 0]),
    activity: [ev('u1', 'tạo task', 26 * HOUR)],
  },
  {
    id: 'AG-29',
    title: 'Trả lời khách hỏi giá combo 3 tháng (Zalo)',
    status: 'review',
    assignee: 'a1',
    priority: 'high',
    labels: ['zalo'],
    requiresReview: true,
    createdAgoMs: 14 * MIN,
    description: 'Chị Lan (Zalo OA) hỏi giá combo 3 tháng và phí ship.',
    subtasks: subs(['Đọc tin khách', 1], ['Tra bảng giá', 1], ['Soạn nháp', 1]),
    output:
      'Dạ chào chị Lan, combo 3 tháng hiện giá **1.290.000đ**, đã gồm phí ship nội thành ạ. Chị muốn em giữ suất cho mình không ạ?',
    runs: [run(1, 'completed', 48, 3, 12 * MIN)],
    activity: [
      ev('a1', 'tạo task từ tin Zalo', 14 * MIN),
      ev('a1', 'xong run #1, chuyển sang **Chờ duyệt**', 12 * MIN),
    ],
  },
  {
    id: 'AG-28',
    title: 'Viết hàm sortBy nhiều khoá + test',
    status: 'review',
    assignee: 'a1',
    priority: 'med',
    labels: ['fe'],
    requiresReview: true,
    createdAgoMs: 50 * MIN,
    description: 'Hàm sort ổn định theo nhiều khoá cho bảng Computers.',
    subtasks: subs(['Viết hàm', 1], ['Viết test', 1]),
    output:
      'Đã thêm `src/utils/sortBy.ts` và 4 test, `pnpm test` **4/4 pass**. Nhánh `feat/sort-by` sẵn sàng mở MR.',
    runs: [run(1, 'completed', 96, 5, 35 * MIN)],
    activity: [
      ev('u1', 'tạo task', 50 * MIN),
      ev('a1', 'xong run #1, chuyển sang **Chờ duyệt**', 35 * MIN),
    ],
  },
  {
    id: 'AG-27',
    title: 'Deploy staging sau khi nâng cấp NestJS 12',
    status: 'todo',
    assignee: 'a3',
    priority: 'urgent',
    labels: ['infra'],
    requiresReview: false,
    createdAgoMs: 50 * HOUR,
    blockedReason: 'build-box offline',
    description: 'Build image `be` mới, chạy migration rồi `up -d` trên staging.',
    subtasks: subs(['Build image', 0], ['Migration', 0], ['Health check', 0]),
    runs: [run(1, 'failed', 212, 6, 48 * HOUR, 'migration:run exit 1')],
    activity: [
      ev('u3', 'tạo task', 50 * HOUR),
      ev('a3', 'run #1 thất bại ở `migration:run`', 48 * HOUR, 'error'),
      cm(
        'u3',
        'Lần trước fail ở bước migration, nhớ chạy `migration:run` trước khi `up`.',
        47 * HOUR,
      ),
    ],
  },
  {
    id: 'AG-26',
    title: 'Review MR !42: thêm module computers',
    status: 'todo',
    assignee: 'a1',
    priority: 'high',
    labels: ['be'],
    requiresReview: true,
    createdAgoMs: 76 * HOUR,
    description: 'Đọc diff, chạy test, ghi nhận xét vào MR.',
    subtasks: subs(['Đọc diff', 0], ['Chạy test', 0], ['Viết nhận xét', 0]),
    runs: [run(1, 'expired', 0, 0, 72 * HOUR)],
    activity: [
      ev('u1', 'tạo task', 76 * HOUR),
      ev('a1', 'hết hạn lease, trả lại hàng đợi', 72 * HOUR),
    ],
  },
  {
    id: 'AG-25',
    title: 'Viết docs API cho /computers',
    status: 'todo',
    assignee: 'a1',
    priority: 'low',
    labels: ['docs'],
    requiresReview: true,
    createdAgoMs: 5 * HOUR,
    description: 'Mô tả các endpoint, ví dụ request/response.',
    activity: [ev('u3', 'tạo task', 5 * HOUR)],
  },
  {
    id: 'AG-24',
    title: 'Chuẩn hoá data khách hàng trong Sheet',
    status: 'todo',
    assignee: 'a2',
    priority: 'med',
    labels: ['data'],
    requiresReview: true,
    createdAgoMs: 3 * HOUR,
    description: 'Chuẩn hoá số điện thoại, email; gộp dòng trùng.',
    subtasks: subs(['Chuẩn hoá', 0], ['Gộp trùng', 0]),
    activity: [ev('u2', 'tạo task', 3 * HOUR)],
  },
  {
    id: 'AG-22',
    title: 'Chuyển migrations sang TypeORM 1',
    status: 'backlog',
    assignee: null,
    priority: 'med',
    labels: ['be'],
    requiresReview: true,
    createdAgoMs: 30 * HOUR,
    activity: [ev('u3', 'tạo task', 30 * HOUR)],
  },
  {
    id: 'AG-21',
    title: 'Kết nối Telegram cho kênh CSKH',
    status: 'backlog',
    assignee: null,
    priority: 'low',
    labels: ['zalo'],
    requiresReview: false,
    createdAgoMs: 28 * HOUR,
    activity: [ev('u1', 'tạo task', 28 * HOUR)],
  },
  {
    id: 'AG-20',
    title: 'Báo cáo tuần gửi ban giám đốc',
    status: 'backlog',
    assignee: 'u3',
    priority: 'med',
    labels: ['docs'],
    requiresReview: false,
    createdAgoMs: 20 * HOUR,
    activity: [ev('u3', 'tạo task', 20 * HOUR)],
  },
  {
    id: 'AG-19',
    title: 'Nâng cấp NestJS 12 + TypeORM 1',
    status: 'done',
    assignee: 'a1',
    priority: 'high',
    labels: ['be'],
    requiresReview: true,
    createdAgoMs: 30 * HOUR,
    output: 'Đã nâng cấp, 9/9 test BE pass.',
    runs: [run(1, 'completed', 1260, 38, 25 * HOUR)],
    activity: [ev('u1', 'duyệt kết quả, chuyển sang **Xong**', 24 * HOUR)],
  },
  {
    id: 'AG-18',
    title: 'Cài Rust toolchain cho Tauri',
    status: 'done',
    assignee: 'a1',
    priority: 'med',
    labels: ['infra'],
    requiresReview: false,
    createdAgoMs: 26 * HOUR,
    runs: [run(1, 'completed', 140, 4, 25 * HOUR)],
    activity: [],
  },
  {
    id: 'AG-17',
    title: 'Dịch landing page sang tiếng Anh',
    status: 'done',
    assignee: 'a2',
    priority: 'low',
    labels: ['docs'],
    requiresReview: true,
    createdAgoMs: 7 * HOUR,
    runs: [run(1, 'completed', 310, 7, 6 * HOUR)],
    activity: [],
  },
  {
    id: 'AG-16',
    title: 'Crawl giá đối thủ (lần 1)',
    status: 'done',
    assignee: 'a2',
    priority: 'med',
    labels: ['research'],
    requiresReview: false,
    createdAgoMs: 7 * HOUR,
    runs: [
      run(2, 'completed', 1200, 6, 5 * HOUR),
      run(1, 'failed', 360, 2, 5.5 * HOUR, 'WebFetch 403'),
    ],
    activity: [],
  },
  {
    id: 'AG-15',
    title: 'Dọn nhãn Gmail cũ',
    status: 'done',
    assignee: 'a1',
    priority: 'low',
    labels: ['email'],
    requiresReview: false,
    createdAgoMs: 3 * HOUR,
    runs: [run(1, 'completed', 720, 3, 150 * MIN)],
    activity: [],
  },
];

/** Highest `AG-<n>` in the fixtures: the workspace counter continues from here. */
export const SEEDED_TASK_SEQ = 31;

/**
 * Inserts the fixture tasks, their finished runs (with completed assignments, so the run
 * timeline has history), activity, and the two runs in progress. Idempotent per workspace:
 * does nothing when the workspace already has tasks.
 */
export const seedTasksFor = async (
  manager: EntityManager,
  world: TaskSeedWorld,
): Promise<boolean> => {
  const { workspaceId, now } = world;
  if (await manager.exists(TaskEntity, { where: { workspaceId } })) return false;

  const actor = (key: ActorKey): string =>
    key.startsWith('a') ? world.agents[key as AgentKey] : world.members[key as MemberKey];
  const computers = new Map(
    (await manager.find(Agent, { where: { workspaceId } })).map((a) => [a.id, a.computerId]),
  );

  for (const [rank, seed] of TASK_SEEDS.entries()) {
    const assigneeId = seed.assignee ? actor(seed.assignee) : null;
    const isAgent = !!seed.assignee?.startsWith('a');
    await manager.insert(TaskEntity, {
      workspaceId,
      id: seed.id,
      title: seed.title,
      description: seed.description ?? '',
      status: seed.status,
      assigneeAgentId: isAgent ? assigneeId : null,
      assigneeMemberId: isAgent ? null : assigneeId,
      priority: seed.priority,
      labels: seed.labels,
      chatId: null,
      requiresReview: seed.requiresReview,
      subtasks: seed.subtasks ?? [],
      output: seed.output ?? null,
      blockedReason: seed.blockedReason ?? null,
      error: null,
      rank,
      createdAt: new Date(now - seed.createdAgoMs),
    });

    const agentId = isAgent ? assigneeId! : null;
    const steps = stepsFor(seed.labels);
    for (const r of seed.runs ?? []) {
      const endedAt = new Date(now - r.agoMs);
      const assignment = await manager.save(
        manager.create(Assignment, {
          workspaceId,
          agentId: agentId!,
          computerId: computers.get(agentId!)!,
          sourceKind: 'task',
          sourceId: seed.id,
          status: r.status,
          attempt: 1,
          toolCalls: r.toolCalls,
          error: r.error ?? null,
          startedAt: new Date(endedAt.getTime() - r.durationSec * 1000),
          endedAt,
          createdAt: new Date(endedAt.getTime() - r.durationSec * 1000),
        }),
      );
      await manager.insert(TaskRun, {
        workspaceId,
        taskId: seed.id,
        assignmentId: assignment.id,
        n: r.n,
        step: r.toolCalls,
        steps,
        status: r.status,
        durationSec: r.durationSec,
        toolCalls: r.toolCalls,
        error: r.error ?? null,
        finalizedAt: endedAt,
      });
    }

    if (seed.active && agentId) {
      const startedAt = new Date(now - seed.active.startedAgoMs);
      const assignment = await manager.save(
        manager.create(Assignment, {
          workspaceId,
          agentId,
          computerId: computers.get(agentId)!,
          sourceKind: 'task',
          sourceId: seed.id,
          status: 'running',
          attempt: 1,
          toolCalls: seed.active.step,
          startedAt,
          leaseExpiresAt: new Date(now + LEASE_MS),
          createdAt: startedAt,
        }),
      );
      await manager.insert(TaskRun, {
        workspaceId,
        taskId: seed.id,
        assignmentId: assignment.id,
        n: seed.active.n,
        step: seed.active.step,
        steps,
        status: null,
        durationSec: null,
        toolCalls: null,
        error: null,
        finalizedAt: null,
      });
    }

    for (const item of seed.activity) {
      await manager.insert(TaskActivityRow, {
        workspaceId,
        taskId: seed.id,
        by: item.by ? actor(item.by) : null,
        kind: item.kind ?? 'event',
        text: item.text,
        tone: item.tone ?? 'normal',
        at: new Date(now - item.agoMs),
      });
    }
  }

  await manager.update(Workspace, { id: workspaceId }, { taskSeq: SEEDED_TASK_SEQ });
  return true;
};

/** Seeds the `khanhpv` workspace; run after the auth and agents seeds. */
export const seedTasks = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:tasks');

  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    const agentByName = new Map(
      (await manager.find(Agent, { where: { workspaceId: workspace.id } })).map((a) => [
        a.name,
        a.id,
      ]),
    );
    const memberByEmail = new Map(
      (await manager.find(Member, { where: { workspaceId: workspace.id } })).map((m) => [
        m.email,
        m.id,
      ]),
    );
    const need = (value: string | undefined, what: string): string => {
      if (!value) throw new Error(`Seed:tasks needs ${what}; run the auth and agents seeds first`);
      return value;
    };
    const seeded = await seedTasksFor(manager, {
      workspaceId: workspace.id,
      now: Date.now(),
      agents: {
        a1: need(agentByName.get("khanhpv's Claude"), "agent khanhpv's Claude"),
        a2: need(agentByName.get('Research Bot'), 'agent Research Bot'),
        a3: need(agentByName.get('Deployer'), 'agent Deployer'),
      },
      members: {
        u1: need(memberByEmail.get('khanhpv@holatech.tech'), 'member khanhpv'),
        u2: need(memberByEmail.get('hang@holatech.tech'), 'member Hằng'),
        u3: need(memberByEmail.get('minh@holatech.tech'), 'member Minh'),
      },
    });
    logger.log(seeded ? `Created ${TASK_SEEDS.length} tasks` : 'Tasks already seeded, skipping');
  });
};
