import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { DASHBOARD_DAYS, WORKSPACE_TIMEZONE } from '../../contacts';
import { Agent } from '../../modules/agents/entities/agent.entity';
import { Computer } from '../../modules/computers/entities/computer.entity';
import { FINISHED_SQL } from '../../modules/dashboard/dashboard.sql';
import { lastDays, localDate } from '../../modules/dashboard/dashboard.util';
import {
  AttentionItemRow,
  attentionKey,
} from '../../modules/dashboard/entities/attention-item.entity';
import { FeedItemRow } from '../../modules/dashboard/entities/feed-item.entity';
import { Member } from '../../modules/workspace/entities/member.entity';
import { Workspace } from '../../modules/workspace/entities/workspace.entity';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** `source_id` of the synthetic finished chat assignments that fill the 14-day chart. */
export const SEED_HISTORY_SOURCE_ID = 'seed-history';

/** The fixture chart (apps/fe/src/mocks/fixtures.ts), oldest day first. */
const DONE = [6, 9, 7, 11, 8, 4, 3, 10, 12, 9, 14, 11, 10, 13];
const FAIL = [1, 0, 2, 1, 0, 0, 1, 1, 0, 2, 1, 0, 1, 1];
/** Rough share of the finished work per agent (the fixture's byAgent). */
const AGENT_WEIGHTS: [string, number][] = [
  ["khanhpv's Claude", 55],
  ['Research Bot', 24],
  ['Deployer', 6],
];
/** The fixture's `minutesToday`. */
const MINUTES_TODAY = 38;

/** A stable uuid per (workspace, seed key), so re-seeding never duplicates rows. */
const seedUuid = (workspaceId: string, key: string): string => {
  const hex = createHash('sha1').update(`${workspaceId}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const need = <T>(value: T | undefined, what: string): T => {
  if (!value) throw new Error(`Seed:dashboard needs ${what}; run the auth and agents seeds first`);
  return value;
};

/**
 * Seeds the attention items att-1..3 and the feed f1..f5 of the `khanhpv` workspace, plus
 * clearly marked synthetic history (finished chat assignments with source_id
 * `seed-history`) so the 14-day chart looks like the fixture. Idempotent.
 */
export const seedDashboard = async (ds: DataSource): Promise<void> => {
  const logger = new Logger('Seed:dashboard');
  await ds.transaction(async (manager) => {
    const workspace = await manager.findOne(Workspace, { where: { slug: 'khanhpv' } });
    if (!workspace) {
      logger.warn('Workspace khanhpv not found, run the auth seed first');
      return;
    }
    await seedDashboardFor(manager, workspace.id, Date.now(), logger);
  });
};

const seedDashboardFor = async (
  manager: EntityManager,
  workspaceId: string,
  now: number,
  logger: Logger,
): Promise<void> => {
  const agents = await manager.find(Agent, { where: { workspaceId } });
  const members = await manager.find(Member, { where: { workspaceId } });
  const computers = await manager.find(Computer, { where: { workspaceId } });
  const agentByName = (name: string) =>
    need(
      agents.find((a) => a.name === name),
      `agent ${name}`,
    );
  const u1 = need(
    members.find((m) => m.email === 'khanhpv@holatech.tech'),
    'member khanhpv',
  ).id;
  const u3 = need(
    members.find((m) => m.email === 'minh@holatech.tech'),
    'member Minh',
  ).id;
  const a1 = agentByName("khanhpv's Claude").id;
  const a2 = agentByName('Research Bot').id;
  const a3 = agentByName('Deployer').id;
  const buildBox = need(
    computers.find((c) => c.name === 'build-box'),
    'computer build-box',
  ).id;

  const attention = [
    {
      key: 'att-1',
      kind: 'error' as const,
      title: 'deploy staging thất bại',
      meta: 'Deployer · #all-members · 2 ngày trước',
      action: 'Chạy lại',
      taskId: 'AG-27',
      computerId: null,
      agoMs: 48 * HOUR,
    },
    {
      key: 'att-2',
      kind: 'warning' as const,
      title: 'review MR !42 hết hạn lease',
      meta: "khanhpv's Claude · DM · 3 ngày trước",
      action: 'Giao lại',
      taskId: 'AG-26',
      computerId: null,
      agoMs: 72 * HOUR,
    },
    {
      key: 'att-3',
      kind: 'offline' as const,
      title: 'build-box offline 2 giờ',
      meta: 'Deployer không nhận được việc mới',
      action: 'Hướng dẫn',
      taskId: null,
      computerId: buildBox,
      agoMs: 2 * HOUR,
    },
  ];
  for (const { key, agoMs, ...item } of attention) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AttentionItemRow)
      .values({
        id: seedUuid(workspaceId, key),
        workspaceId,
        ...item,
        dedupKey: attentionKey(item.kind, item.taskId, item.computerId),
        resolvedAt: null,
        createdAt: new Date(now - agoMs),
      })
      .orIgnore()
      .execute();
  }

  const feed = [
    { key: 'f1', by: a1, text: 'trả lời **cách mention agent khác**', agoMs: 23 * HOUR },
    { key: 'f2', by: a2, text: 'chào bạn trong **#test › Hello**', agoMs: 23 * HOUR },
    { key: 'f3', by: u3, text: 'tham gia workspace', agoMs: 26 * HOUR },
    { key: 'f4', by: a3, text: 'thất bại ở **deploy staging**', agoMs: 48 * HOUR },
    { key: 'f5', by: u1, text: 'kết nối máy **khanhpv-MacBook-Pro**', agoMs: 72 * HOUR },
  ];
  for (const { key, agoMs, ...item } of feed) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(FeedItemRow)
      .values({ id: seedUuid(workspaceId, key), workspaceId, ...item, at: new Date(now - agoMs) })
      .orIgnore()
      .execute();
  }

  if (
    await manager
      .query(`SELECT 1 FROM assignments WHERE workspace_id = $1 AND source_id = $2 LIMIT 1`, [
        workspaceId,
        SEED_HISTORY_SOURCE_ID,
      ])
      .then((rows: unknown[]) => rows.length)
  ) {
    return;
  }
  const inserted = await seedHistory(manager, workspaceId, now, agents, computers);
  logger.log(`Added ${inserted} synthetic finished assignment(s) for the dashboard chart`);
};

/** Tops each local day up to the fixture's completed/failed counts. */
const seedHistory = async (
  manager: EntityManager,
  workspaceId: string,
  now: number,
  agents: Agent[],
  computers: Computer[],
): Promise<number> => {
  const today = localDate(new Date(now), WORKSPACE_TIMEZONE);
  const dates = lastDays(today, DASHBOARD_DAYS);
  const existing = new Map<string, { completed: number; failed: number }>(
    dates.map((date) => [date, { completed: 0, failed: 0 }]),
  );
  const rows: { day: string; ok: boolean; count: number; minutes: number }[] = await manager.query(
    FINISHED_SQL,
    [workspaceId, WORKSPACE_TIMEZONE, dates[0], today],
  );
  let minutesToday = 0;
  for (const row of rows) {
    const day = existing.get(row.day);
    if (day) day[row.ok ? 'completed' : 'failed'] += row.count;
    if (row.day === today) minutesToday += row.minutes;
  }

  const weights = AGENT_WEIGHTS.flatMap(([name, weight]) => {
    const agent = agents.find((a) => a.name === name);
    return agent ? Array.from({ length: weight }, () => agent) : [];
  });
  if (!weights.length) return 0;
  const computerOf = new Map(computers.map((c) => [c.id, c]));

  const planned = dates.flatMap((date, i) => {
    const have = existing.get(date)!;
    const todo = [
      ...Array.from({ length: Math.max(0, DONE[i] - have.completed) }, () => 'completed'),
      ...Array.from({ length: Math.max(0, FAIL[i] - have.failed) }, () => 'failed'),
    ];
    return todo.map((status, n) => ({ date, status, n, last: i === dates.length - 1 }));
  });
  // Today's minutes: the fixture total minus what real runs already took, spread over today's
  // synthetic items (1 minute at least each).
  const todays = planned.filter((p) => p.last).length;
  const todayMinutes = Math.max(todays, MINUTES_TODAY - minutesToday);
  let cursor = 0;
  for (const item of planned) {
    const agent = weights[cursor++ % weights.length];
    const computer = computerOf.get(agent.computerId);
    if (!computer) continue;
    const minutes = item.last
      ? Math.max(1, Math.floor(todayMinutes / todays) + (item.n < todayMinutes % todays ? 1 : 0))
      : 2;
    const [{ start }] = (await manager.query(
      `SELECT ($1::date::timestamp AT TIME ZONE $2) AS start`,
      [item.date, WORKSPACE_TIMEZONE],
    )) as { start: Date }[];
    const dayStart = start.getTime();
    // Spread the day's items from 09:00 on, but never into the future or the previous day.
    const spread = dayStart + 9 * HOUR + item.n * 25 * MIN;
    const endedAt = new Date(
      item.last
        ? Math.max(dayStart + 1_000 * (item.n + 1), Math.min(now - item.n * 1_000, spread))
        : spread,
    );
    await manager.query(
      `INSERT INTO assignments
         (workspace_id, agent_id, computer_id, source_kind, source_id, status, attempt,
          started_at, ended_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'chat', $4, $5, 1, $6, $7, $6, $7)`,
      [
        workspaceId,
        agent.id,
        computer.id,
        SEED_HISTORY_SOURCE_ID,
        item.status,
        new Date(endedAt.getTime() - minutes * MIN),
        endedAt,
      ],
    );
  }
  return planned.length;
};
