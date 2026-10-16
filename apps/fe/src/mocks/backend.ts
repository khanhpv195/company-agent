import type {
  Agent,
  CreateTaskInput,
  RealtimeEvent,
  RunSpan,
  Task,
  TaskActivity,
  TaskPriority,
  TaskRun,
  TaskStatus,
  TaskStep,
  UpdateTaskInput,
} from '@repo/shared';
import { iso, seed, type MockDb } from './fixtures';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BackendOptions {
  db?: MockDb;
  random?: () => number;
  now?: () => number;
  /** Deferred work (agent pick-up, replies). Tests pass a manual scheduler. */
  later?: (fn: () => void, ms: number) => void;
}

export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, med: 2, low: 3 };
export const STATUS_NAME: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Cần làm',
  doing: 'Đang làm',
  review: 'Chờ duyệt',
  done: 'Xong',
};
const PRIORITY_NAME: Record<TaskPriority, string> = {
  urgent: 'Khẩn',
  high: 'Cao',
  med: 'Trung bình',
  low: 'Thấp',
};

const step = (tool: string, input: string): TaskStep => ({ tool, input });
/** Tool scripts an agent "runs" for a task, picked by its first label. */
export const STEPS: Record<string, TaskStep[]> = {
  email: [
    step('Bash', 'gws gmail list --unread --since 18:00'),
    step('Read', '42 email · phân loại theo người gửi'),
    step('Bash', 'gws gmail label --add "Cần xử lý" ×3'),
    step('Write', 'summary/email-sang-nay.md'),
    step('Bash', 'agent send --room dm-a1 summary.md'),
  ],
  research: [
    step('WebSearch', '"phần mềm bán hàng" bảng giá 2026'),
    step('WebFetch', 'doithu-a.vn/bang-gia'),
    step('WebFetch', 'doithu-b.vn/pricing'),
    step('Bash', 'python compare.py --out pricing.csv'),
    step('Write', 'reports/doi-thu.md'),
  ],
  fe: [
    step('Read', 'apps/fe/src/App.tsx'),
    step('Grep', '"apiRequest" apps/fe/src'),
    step('Edit', 'apps/fe/src/features/…'),
    step('Bash', 'pnpm --filter fe typecheck'),
    step('Bash', 'pnpm --filter fe test'),
  ],
  be: [
    step('Bash', 'git fetch origin mr/42'),
    step('Read', 'apps/be/src/computers/computers.service.ts'),
    step('Read', 'apps/be/src/computers/computers.controller.ts'),
    step('Bash', 'pnpm --filter be test'),
    step('Write', 'review-mr-42.md'),
  ],
  infra: [
    step('Bash', 'docker compose build be'),
    step('Bash', 'pnpm --filter be migration:run'),
    step('Bash', 'docker compose up -d'),
    step('Bash', 'curl -sf :3000/api/v1/health'),
  ],
  zalo: [
    step('Read', 'Zalo OA · tin nhắn của khách'),
    step('Read', 'bang-gia-combo.xlsx'),
    step('Write', 'bản nháp trả lời'),
  ],
  data: [
    step('Read', 'Khách hàng 2026.xlsx · 1.240 dòng'),
    step('Bash', 'python normalize.py --phone --email'),
    step('Bash', 'python dedupe.py → 37 trùng'),
    step('Write', 'Khách hàng 2026 (chuẩn hoá).xlsx'),
  ],
  docs: [
    step('Read', 'apps/be/src/computers/*.ts'),
    step('Write', 'docs/api/computers.md'),
    step('Bash', 'pnpm lint:md'),
  ],
};
export const stepsFor = (labels: string[]) => STEPS[labels[0]] ?? STEPS.fe;

export function inferLabel(title: string): string {
  if (/email|mail/i.test(title)) return 'email';
  if (/đối thủ|nghiên cứu|research|tìm/i.test(title)) return 'research';
  if (/deploy|docker|server/i.test(title)) return 'infra';
  if (/zalo|khách/i.test(title)) return 'zalo';
  if (/sheet|data|excel/i.test(title)) return 'data';
  if (/docs|tài liệu|báo cáo/i.test(title)) return 'docs';
  return 'fe';
}

/** Chance that a finished run fails, so the error path shows up while testing the UI. */
const FAIL_RATE = 0.12;

/**
 * In-memory stand-in for the API. Holds the task rules the real backend must keep:
 * one run per agent at a time, priority-ordered queues, auto pick-up when idle,
 * offline computers block work, and review before done.
 */
export class MockBackend {
  readonly db: MockDb;
  readonly random: () => number;
  readonly now: () => number;
  readonly later: (fn: () => void, ms: number) => void;
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  /** Agents busy with a chat assignment (outside the task board). */
  readonly chatBusy = new Set<string>();

  constructor(options: BackendOptions = {}) {
    this.now = options.now ?? Date.now;
    this.db = options.db ?? seed(this.now());
    this.random = options.random ?? Math.random;
    this.later = options.later ?? ((fn, ms) => void setTimeout(fn, ms));
    for (const t of this.db.tasks)
      if (t.activeRun && !t.activeRun.steps.length) t.activeRun.steps = stepsFor(t.labels);
    this.syncAgents();
  }

  // ---------- events ----------
  subscribe(fn: (event: RealtimeEvent) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  emit(event: RealtimeEvent) {
    for (const fn of this.listeners) fn(event);
  }
  notice(text: string, agentId: string | null, taskId: string | null) {
    this.emit({ type: 'notice', text, agentId, taskId });
  }
  /** Broadcast that task data (and everything derived from it) changed. */
  changed() {
    this.syncAgents();
    this.emit({ type: 'tasks.changed' });
    this.emit({ type: 'agents.changed' });
  }
  nextId(prefix: string) {
    return `${prefix}-${++this.db.idSeq}`;
  }

  // ---------- lookups ----------
  agent(id: string | null | undefined): Agent | undefined {
    return id ? this.db.agents.find((a) => a.id === id) : undefined;
  }
  computerOf(agent: Agent) {
    const pc = this.db.computers.find((c) => c.id === agent.computerId);
    if (!pc) throw new HttpError(500, `Computer ${agent.computerId} missing`);
    return pc;
  }
  isOnline(agent: Agent) {
    return this.computerOf(agent).status === 'online';
  }
  task(id: string): Task {
    const t = this.db.tasks.find((x) => x.id === id);
    if (!t) throw new HttpError(404, `Task ${id} not found`);
    return t;
  }
  nameOf(id: string | null) {
    if (!id) return 'Chưa giao';
    return this.agent(id)?.name ?? this.db.members.find((m) => m.id === id)?.name ?? id;
  }
  runningOf(agentId: string) {
    return this.db.tasks.find((t) => t.assigneeId === agentId && t.activeRun);
  }
  queueOf(agentId: string) {
    return this.db.tasks
      .filter((t) => t.assigneeId === agentId && t.status === 'todo')
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.rank - b.rank);
  }
  syncAgents() {
    for (const a of this.db.agents) {
      a.status = !this.isOnline(a)
        ? 'offline'
        : this.runningOf(a.id) || this.chatBusy.has(a.id)
          ? 'working'
          : 'idle';
    }
  }

  log(
    t: Task,
    by: string | null,
    text: string,
    tone: TaskActivity['tone'] = 'normal',
    kind: TaskActivity['kind'] = 'event',
  ) {
    t.activity.push({ id: this.nextId('act'), by, at: iso(this.now()), kind, text, tone });
  }

  // ---------- run lifecycle ----------
  startRun(t: Task) {
    const agent = this.agent(t.assigneeId);
    if (!agent) throw new HttpError(409, 'Task has no agent');
    t.status = 'doing';
    t.error = null;
    t.blockedReason = null;
    t.activeRun = {
      n: t.runs.length + 1,
      startedAt: iso(this.now()),
      step: 0,
      steps: stepsFor(t.labels),
      computerId: agent.computerId,
    };
    this.log(t, agent.id, `nhận task, bắt đầu run #${t.activeRun.n}`);
  }

  private endRun(t: Task, status: TaskRun['status'], error: string | null = null): TaskRun {
    const run = t.activeRun;
    if (!run || !t.assigneeId) throw new HttpError(409, 'Task is not running');
    const end = this.now();
    const started = Date.parse(run.startedAt);
    const record: TaskRun = {
      n: run.n,
      status,
      durationSec: Math.round((end - started) / 1000),
      toolCalls: run.step,
      at: iso(end),
      error,
    };
    t.runs.unshift(record);
    const result: RunSpan['result'] =
      status === 'completed' ? 'done' : status === 'failed' ? 'fail' : 'cancel';
    this.db.spans.push({
      agentId: t.assigneeId,
      title: t.title,
      startedAt: run.startedAt,
      endedAt: iso(end),
      result,
    });
    t.activeRun = null;
    if (status === 'completed' || status === 'failed')
      this.countRun(t.assigneeId, status === 'completed', record.durationSec);
    return record;
  }

  /** Feed finished runs into the dashboard numbers. */
  countRun(agentId: string, ok: boolean, durationSec: number) {
    const d = this.db.dashboard;
    const today = d.days[d.days.length - 1];
    if (ok) today.completed++;
    else today.failed++;
    const row = d.byAgent.find((x) => x.agentId === agentId);
    if (row) row.count++;
    else d.byAgent.push({ agentId, count: 1 });
    d.minutesToday += Math.max(1, Math.round(durationSec / 60));
    this.emit({ type: 'dashboard.changed' });
  }

  feed(by: string, text: string) {
    this.db.dashboard.feed.unshift({ id: this.nextId('feed'), by, text, at: iso(this.now()) });
    this.db.dashboard.feed.length = Math.min(this.db.dashboard.feed.length, 8);
    this.emit({ type: 'dashboard.changed' });
  }

  private finishRun(t: Task) {
    const agent = this.agent(t.assigneeId)!;
    const run = t.activeRun!;
    if (this.random() < FAIL_RATE) {
      const at = run.steps[Math.min(run.step, run.steps.length - 1)];
      const r = this.endRun(t, 'failed', `${at.tool} exit 1`);
      t.status = 'todo';
      t.error = `Run #${r.n} lỗi ở ${at.tool}`;
      this.log(t, agent.id, `run #${r.n} thất bại ở \`${at.tool}\``, 'error');
      this.notice(`**${agent.name}** lỗi ở **${t.id}**, đã trả về Cần làm`, agent.id, t.id);
      this.feed(agent.id, `thất bại ở **${t.title}**`);
    } else {
      const r = this.endRun(t, 'completed');
      t.subtasks.forEach((s) => (s.done = true));
      t.output ??= `Đã xong **${t.title.toLowerCase()}** trong ${r.durationSec}s, ${r.toolCalls} tool call. Chi tiết trong log run #${r.n}.`;
      t.status = t.requiresReview ? 'review' : 'done';
      this.log(t, agent.id, `xong run #${r.n}, chuyển sang **${STATUS_NAME[t.status]}**`);
      this.notice(`**${agent.name}** xong **${t.id}** → ${STATUS_NAME[t.status]}`, agent.id, t.id);
      this.feed(agent.id, `xong **${t.title}**`);
    }
    this.later(() => this.pickNext(agent.id), 1800);
  }

  /** An idle, online agent takes the highest-priority task from its queue. */
  pickNext(agentId: string) {
    const agent = this.agent(agentId);
    if (!agent || this.db.scheduler.paused || !this.isOnline(agent) || this.runningOf(agentId))
      return;
    const next = this.queueOf(agentId).find((t) => !t.blockedReason && !t.error);
    if (next) {
      this.startRun(next);
      this.notice(`**${agent.name}** tự nhận **${next.id}** từ hàng đợi`, agent.id, next.id);
    }
    this.changed();
  }

  private cancelRun(t: Task, by: string) {
    const r = this.endRun(t, 'cancelled');
    this.log(t, by, `dừng run #${r.n}`);
  }

  /** Advance one running task by one tool step. Called on a timer. */
  tick() {
    if (this.db.scheduler.paused) return;
    const running = this.db.tasks.filter((t) => t.activeRun && this.agent(t.assigneeId));
    if (!running.length) return;
    this.advance(running[Math.floor(this.random() * running.length)]);
  }

  /** One tool step of `t`'s run; finishes the run after the last step. */
  advance(t: Task) {
    const run = t.activeRun;
    if (!run) return;
    run.step++;
    const n = run.steps.length;
    const due = Math.floor((run.step / n) * t.subtasks.length);
    t.subtasks.forEach((s, i) => {
      if (i < due) s.done = true;
    });
    if (run.step >= n) this.finishRun(t);
    this.changed();
  }

  // ---------- commands ----------
  moveTask(t: Task, to: TaskStatus, by = this.db.meId) {
    if (t.status === to && !(to === 'doing' && !t.activeRun)) return;
    const agent = this.agent(t.assigneeId);
    const wasRunning = !!t.activeRun;
    if (wasRunning && to !== 'doing') this.cancelRun(t, by);
    if (to === 'doing' && agent) {
      const pc = this.computerOf(agent);
      if (pc.status !== 'online') {
        t.status = 'todo';
        t.blockedReason = `${pc.name} offline`;
        this.log(t, by, `giữ ở **Cần làm**: ${pc.name} offline`);
        this.notice(
          `**${agent.name}** đang offline (${pc.name}). **${t.id}** được giữ ở Cần làm.`,
          agent.id,
          t.id,
        );
        return;
      }
      const busy = this.runningOf(agent.id);
      if (busy && busy !== t) {
        t.status = 'todo';
        this.log(t, by, `xếp vào hàng đợi của ${agent.name}`);
        this.notice(
          `**${agent.name}** đang làm **${busy.id}**. Đã xếp **${t.id}** vào hàng đợi.`,
          agent.id,
          t.id,
        );
        return;
      }
      if (!t.activeRun) this.startRun(t);
      this.notice(`Đã giao **${t.id}** cho **${agent.name}**, đang chạy`, agent.id, t.id);
    } else {
      t.status = to;
      if (to === 'done') t.subtasks.forEach((s) => (s.done = true));
      this.log(t, by, `chuyển sang **${STATUS_NAME[to]}**`);
      if (to === 'todo' && agent) this.later(() => this.pickNext(agent.id), 900);
    }
    if (wasRunning && agent) this.later(() => this.pickNext(agent.id), 1500);
  }

  /** Reorder: place `t` before `beforeId` (or at the end). */
  rerank(t: Task, beforeId: string | null | undefined) {
    const list = [...this.db.tasks].sort((a, b) => a.rank - b.rank).filter((x) => x !== t);
    const i = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
    list.splice(i >= 0 ? i : list.length, 0, t);
    list.forEach((x, k) => (x.rank = k));
  }

  createTask(input: CreateTaskInput): Task {
    const title = input.title?.trim();
    if (!title) throw new HttpError(400, 'Title is required');
    const assigneeId = input.assigneeId || null;
    const agent = this.agent(assigneeId);
    const status = input.status ?? 'todo';
    const t: Task = {
      id: `AG-${++this.db.taskSeq}`,
      title,
      description: input.description?.trim() ?? '',
      status: status === 'doing' ? 'todo' : status,
      assigneeId,
      priority: input.priority ?? 'med',
      labels: [inferLabel(title)],
      chatId: agent
        ? (this.db.rooms.find((r) => r.kind === 'dm' && r.agentId === agent.id)?.id ?? 't-hello')
        : null,
      requiresReview: input.requiresReview ?? true,
      createdAt: iso(this.now()),
      subtasks: [],
      runs: [],
      activeRun: null,
      activity: [],
      output: null,
      blockedReason: null,
      error: null,
      rank: Math.min(0, ...this.db.tasks.map((x) => x.rank)) - 1,
    };
    this.log(t, this.db.meId, 'tạo task');
    this.db.tasks.push(t);
    if (status === 'doing') this.moveTask(t, 'doing');
    else if (status === 'todo' && agent) {
      if (!this.runningOf(agent.id) && this.isOnline(agent))
        this.later(() => this.pickNext(agent.id), 900);
      else this.notice(`Đã thêm **${t.id}** vào hàng đợi của **${agent.name}**`, agent.id, t.id);
    }
    this.changed();
    return t;
  }

  updateTask(t: Task, patch: UpdateTaskInput) {
    const me = this.db.meId;
    if (patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId) {
      const to = patch.assigneeId || null;
      if (to && !this.agent(to) && !this.db.members.some((m) => m.id === to))
        throw new HttpError(400, 'Unknown assignee');
      if (t.activeRun) this.cancelRun(t, me);
      const prev = t.assigneeId;
      t.assigneeId = to;
      t.blockedReason = null;
      t.error = null;
      this.log(t, me, to ? `giao cho **${this.nameOf(to)}**` : 'bỏ giao');
      if (to && this.agent(to) && (t.status === 'doing' || t.status === 'todo')) {
        t.status = 'todo';
        this.moveTask(t, 'doing');
      }
      if (prev && this.agent(prev)) this.later(() => this.pickNext(prev), 1500);
    }
    if (patch.priority && patch.priority !== t.priority) {
      t.priority = patch.priority;
      this.log(t, me, `đổi ưu tiên thành **${PRIORITY_NAME[t.priority]}**`);
    }
    if (patch.requiresReview !== undefined) t.requiresReview = patch.requiresReview;
    if (patch.subtasks)
      t.subtasks = patch.subtasks.map((s) => ({ title: s.title, done: !!s.done }));
    this.changed();
  }

  stopTask(t: Task) {
    if (!t.activeRun) throw new HttpError(409, 'Task is not running');
    const agentId = t.assigneeId!;
    this.cancelRun(t, this.db.meId);
    t.status = 'todo';
    t.blockedReason = null;
    t.error = 'Đã dừng thủ công';
    this.later(() => this.pickNext(agentId), 1500);
    this.changed();
  }

  retryTask(t: Task) {
    t.error = null;
    this.moveTask(t, 'doing');
    this.changed();
  }

  /** Jump the queue: run now if the agent is free, otherwise go first in line as urgent. */
  runNow(t: Task) {
    const agent = this.agent(t.assigneeId);
    if (!agent) throw new HttpError(409, 'Task has no agent');
    const busy = this.runningOf(agent.id);
    if (busy && busy !== t) {
      t.rank = Math.min(...this.db.tasks.map((x) => x.rank)) - 1;
      t.priority = 'urgent';
      t.error = null;
      this.log(t, this.db.meId, 'đưa lên đầu hàng đợi (ưu tiên **Khẩn**)');
      this.notice(
        `**${t.id}** lên đầu hàng đợi, ${agent.name} sẽ làm ngay sau **${busy.id}**`,
        agent.id,
        t.id,
      );
    } else {
      t.error = null;
      this.moveTask(t, 'doing');
    }
    this.changed();
  }

  approveTask(t: Task) {
    if (t.status !== 'review') throw new HttpError(409, 'Task is not waiting for review');
    t.status = 'done';
    this.log(t, this.db.meId, 'duyệt kết quả, chuyển sang **Xong**');
    this.notice(
      `Đã duyệt **${t.id}**`,
      t.assigneeId && this.agent(t.assigneeId) ? t.assigneeId : null,
      null,
    );
    this.feed(this.db.meId, `duyệt **${t.title}**`);
    this.changed();
  }

  reviseTask(t: Task, note?: string) {
    if (note?.trim()) this.log(t, this.db.meId, note.trim(), 'normal', 'comment');
    this.log(t, this.db.meId, 'yêu cầu sửa');
    t.status = 'todo';
    t.output = null;
    if (this.agent(t.assigneeId)) this.moveTask(t, 'doing');
    this.changed();
  }

  comment(t: Task, markdown: string) {
    const text = markdown.trim();
    if (!text) throw new HttpError(400, 'Comment is empty');
    this.log(t, this.db.meId, text, 'normal', 'comment');
    const mentioned = this.db.agents.find(
      (a) => text.includes('@' + a.name) || (a.id === t.assigneeId && /@agent|@claude/i.test(text)),
    );
    if (mentioned) {
      this.later(() => {
        this.log(
          t,
          mentioned.id,
          'Đã nhận, em sẽ cập nhật trong run tiếp theo.',
          'normal',
          'comment',
        );
        this.changed();
      }, 1400);
    }
    this.changed();
  }

  setPaused(paused: boolean) {
    this.db.scheduler.paused = paused;
    if (!paused) for (const a of this.db.agents) this.pickNext(a.id);
    this.changed();
  }

  /** Keep the online computer's heartbeat fresh. */
  heartbeat() {
    for (const c of this.db.computers) {
      if (c.status === 'online')
        c.lastHeartbeatAt = iso(this.now() - Math.floor(this.random() * 3000));
    }
    this.emit({ type: 'computers.changed' });
  }
}
