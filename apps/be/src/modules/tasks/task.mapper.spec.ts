import type { Assignment } from '../gateway/entities/assignment.entity';
import type { TaskRun } from './entities/task-run.entity';
import type { TaskEntity } from './entities/task.entity';
import { assigneeIdOf, toActiveRun, toRunSpan, toTask, toTaskRun } from './task.mapper';

const at = (iso: string) => new Date(iso);

describe('task mapper', () => {
  it('exposes the agent or the member as one assignee id', () => {
    expect(assigneeIdOf({ assigneeAgentId: 'a', assigneeMemberId: null })).toBe('a');
    expect(assigneeIdOf({ assigneeAgentId: null, assigneeMemberId: 'm' })).toBe('m');
    expect(assigneeIdOf({ assigneeAgentId: null, assigneeMemberId: null })).toBeNull();
  });

  it('starts an active run at the assignment start, or its creation while still offered', () => {
    const run = { n: 2, step: 1, steps: [{ tool: 'Bash', input: 'x' }] } as TaskRun;
    const offered = { createdAt: at('2026-01-01T00:00:00Z'), startedAt: null, computerId: 'c' };
    expect(toActiveRun(run, offered as Assignment)).toEqual({
      n: 2,
      startedAt: '2026-01-01T00:00:00.000Z',
      step: 1,
      steps: run.steps,
      computerId: 'c',
    });
    const started = { ...offered, startedAt: at('2026-01-01T00:00:05Z') };
    expect(toActiveRun(run, started as Assignment).startedAt).toBe('2026-01-01T00:00:05.000Z');
  });

  it('maps a finalized run and tolerates missing numbers', () => {
    const run = {
      n: 1,
      status: 'failed',
      durationSec: null,
      toolCalls: 3,
      finalizedAt: at('2026-01-01T00:01:00Z'),
      error: 'Bash exit 1',
    } as TaskRun;
    expect(toTaskRun(run)).toEqual({
      n: 1,
      status: 'failed',
      durationSec: 0,
      toolCalls: 3,
      at: '2026-01-01T00:01:00.000Z',
      error: 'Bash exit 1',
    });
  });

  it('maps run results onto span results', () => {
    const assignment = {
      agentId: 'a',
      startedAt: at('2026-01-01T00:00:00Z'),
      createdAt: at('2025-12-31T23:59:00Z'),
      endedAt: at('2026-01-01T00:02:00Z'),
    };
    const span = (status: TaskRun['status']) => toRunSpan({ status }, assignment, 'T', null).result;
    expect([span('completed'), span('failed'), span('cancelled'), span('expired')]).toEqual([
      'done',
      'fail',
      'cancel',
      'cancel',
    ]);
    expect(toRunSpan({ status: 'completed' }, assignment, 'T', null)).toMatchObject({
      agentId: 'a',
      title: 'T',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:02:00.000Z',
    });
  });

  it('builds a task with its parts and the single assignee id', () => {
    const row = {
      id: 'AG-1',
      title: 't',
      description: '',
      status: 'todo',
      assigneeAgentId: null,
      assigneeMemberId: 'm',
      priority: 'med',
      labels: ['fe'],
      chatId: null,
      requiresReview: true,
      createdAt: at('2026-01-01T00:00:00Z'),
      subtasks: [{ title: 's', done: true }],
      output: null,
      blockedReason: null,
      error: null,
      rank: 3,
    } as TaskEntity;
    const task = toTask(row, { runs: [], activeRun: null, activity: [] });
    expect(task).toMatchObject({ id: 'AG-1', assigneeId: 'm', rank: 3, labels: ['fe'] });
    expect(task.subtasks).toEqual([{ title: 's', done: true }]);
  });
});
