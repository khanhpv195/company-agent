import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { RunSpan, SchedulerState, Task } from '@repo/shared';
import { In, IsNull, Repository } from 'typeorm';
import { Assignment } from '../gateway/entities/assignment.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { TaskActivityRow } from './entities/task-activity.entity';
import { TaskRun } from './entities/task-run.entity';
import { TaskEntity } from './entities/task.entity';
import {
  toActiveRun,
  toRunSpan,
  toTask,
  toTaskActivity,
  toTaskRun,
  type TaskParts,
} from './task.mapper';

/** Newest activity rows returned per task on the board. */
const ACTIVITY_PER_TASK = 50;

/** Read side of the board. A fixed number of queries however many tasks there are. */
@Injectable()
export class TasksQueryService {
  constructor(
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskRun) private readonly runs: Repository<TaskRun>,
    @InjectRepository(TaskActivityRow) private readonly activity: Repository<TaskActivityRow>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
  ) {}

  /** The board, sorted by rank. */
  list(workspaceId: string): Promise<Task[]> {
    return this.build(workspaceId);
  }

  async get(workspaceId: string, id: string): Promise<Task> {
    const [task] = await this.build(workspaceId, [id]);
    if (!task) throw new NotFoundException({ message: 'tasks.NOT_FOUND', args: { id } });
    return task;
  }

  /** Finished runs whose assignment ended after `since` (all of them when it is missing or invalid). */
  async spans(workspaceId: string, since?: string): Promise<RunSpan[]> {
    const from = since ? Date.parse(since) : Number.NaN;
    const query = this.runs
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.assignment', 'a')
      .innerJoinAndSelect('r.task', 't')
      .where('r.workspace_id = :workspaceId', { workspaceId })
      .andWhere('r.finalized_at IS NOT NULL');
    if (!Number.isNaN(from)) query.andWhere('a.ended_at > :from', { from: new Date(from) });
    const rows = await query.orderBy('a.ended_at', 'ASC').addOrderBy('r.n', 'ASC').getMany();
    return rows.map((run) => toRunSpan(run, run.assignment, run.task.title, run.finalizedAt));
  }

  async scheduler(workspaceId: string): Promise<SchedulerState> {
    const workspace = await this.workspaces.findOneByOrFail({ id: workspaceId });
    return { paused: workspace.schedulerPaused };
  }

  private async build(workspaceId: string, ids?: string[]): Promise<Task[]> {
    const where = ids ? { workspaceId, id: In(ids) } : { workspaceId };
    const rows = await this.tasks.find({ where, order: { rank: 'ASC', id: 'ASC' } });
    if (!rows.length) return [];
    const taskIds = ids ? rows.map((row) => row.id) : undefined;
    const taskFilter = taskIds ? { taskId: In(taskIds) } : {};

    const costById = new Map<string, number | null>();
    // Finalized runs never need their tool script; only the active run does.
    const [finished, active] = await Promise.all([
      (async () => {
        // Cost comes from the assignment through a join, not a second query by id list.
        const query = this.runs
          .createQueryBuilder('r')
          .leftJoin('r.assignment', 'a')
          .select([
            'r.id',
            'r.taskId',
            'r.assignmentId',
            'r.n',
            'r.status',
            'r.durationSec',
            'r.toolCalls',
            'r.error',
            'r.finalizedAt',
          ])
          .addSelect('a.cost_usd', 'cost_usd')
          .where('r.workspace_id = :workspaceId', { workspaceId })
          .andWhere('r.finalized_at IS NOT NULL')
          .orderBy('r.n', 'DESC');
        if (taskIds) query.andWhere('r.task_id IN (:...taskIds)', { taskIds });
        const { entities, raw } = await query.getRawAndEntities<{
          r_id: string;
          cost_usd: string | null;
        }>();
        for (const row of raw)
          costById.set(row.r_id, row.cost_usd === null ? null : Number(row.cost_usd));
        return entities;
      })(),
      this.runs.find({ where: { workspaceId, ...taskFilter, finalizedAt: IsNull() } }),
    ]);
    const assignments = active.length
      ? await this.assignments.findBy({ id: In(active.map((run) => run.assignmentId)) })
      : [];
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    // Latest ACTIVITY_PER_TASK rows per task (window function), returned oldest first.
    const activityQuery = this.activity
      .createQueryBuilder('x')
      .where(
        `x.id IN (
          SELECT s.id FROM (
            SELECT y.id, row_number() OVER (PARTITION BY y.task_id ORDER BY y.at DESC, y.seq DESC) AS rn
            FROM task_activity y
            WHERE y.workspace_id = :workspaceId ${taskIds ? 'AND y.task_id IN (:...taskIds)' : ''}
          ) s WHERE s.rn <= :cap
        )`,
        { workspaceId, taskIds, cap: ACTIVITY_PER_TASK },
      )
      .andWhere('x.workspace_id = :workspaceId', { workspaceId });
    const activity = await activityQuery
      .orderBy('x.at', 'ASC')
      .addOrderBy('x.seq', 'ASC')
      .getMany();

    const parts = new Map<string, TaskParts>(
      rows.map((row) => [row.id, { runs: [], activeRun: null, activity: [] }]),
    );
    for (const run of finished)
      parts.get(run.taskId)?.runs.push(toTaskRun(run, costById.get(run.id) ?? null));
    for (const run of active) {
      const assignment = assignmentById.get(run.assignmentId);
      const part = parts.get(run.taskId);
      if (part && assignment) part.activeRun = toActiveRun(run, assignment);
    }
    for (const row of activity) parts.get(row.taskId)?.activity.push(toTaskActivity(row));
    return rows.map((row) => toTask(row, parts.get(row.id)!));
  }
}
