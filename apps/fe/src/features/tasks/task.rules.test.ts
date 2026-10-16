import {
  currentStep,
  firstRank,
  inferLabel,
  pickableOf,
  placeBefore,
  PRIORITY_RANK,
  queueOf,
  runningOf,
  spanResult,
  statusAfterRun,
  STEPS,
  stepsFor,
  subtasksDue,
  type Task,
  type TaskPriority,
} from '@repo/shared';
import { describe, expect, it } from 'vitest';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: '',
  status: 'todo',
  assigneeId: 'a1',
  priority: 'med',
  labels: [],
  chatId: null,
  requiresReview: true,
  createdAt: '2026-10-16T09:00:00.000Z',
  subtasks: [],
  runs: [],
  activeRun: null,
  activity: [],
  output: null,
  blockedReason: null,
  error: null,
  rank: 0,
  ...over,
});

const run = (step: number, tools: string[]) => ({
  n: 1,
  startedAt: '2026-10-16T09:00:00.000Z',
  step,
  steps: tools.map((tool) => ({ tool, input: '' })),
  computerId: 'pc1',
});

describe('shared task rules', () => {
  it('ranks priorities urgent first', () => {
    const order = (Object.keys(PRIORITY_RANK) as TaskPriority[]).sort(
      (a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b],
    );
    expect(order).toEqual(['urgent', 'high', 'med', 'low']);
  });

  it('orders a queue by priority, then board rank, only todo tasks of that agent', () => {
    const list = [
      task('low-0', { priority: 'low', rank: 0 }),
      task('med-5', { priority: 'med', rank: 5 }),
      task('med-2', { priority: 'med', rank: 2 }),
      task('urgent-9', { priority: 'urgent', rank: 9 }),
      task('doing', { priority: 'urgent', status: 'doing' }),
      task('other', { priority: 'urgent', assigneeId: 'a2' }),
    ];
    expect(queueOf(list, 'a1').map((t) => t.id)).toEqual(['urgent-9', 'med-2', 'med-5', 'low-0']);
  });

  it('skips blocked and failed tasks when picking', () => {
    const list = [
      task('blocked', { priority: 'urgent', blockedReason: 'PC offline' }),
      task('failed', { priority: 'high', error: 'Bash exit 1' }),
      task('ok', { priority: 'low' }),
    ];
    expect(pickableOf(list, 'a1').map((t) => t.id)).toEqual(['ok']);
  });

  it('finds the running task of an agent', () => {
    const list = [task('idle'), task('busy', { status: 'doing', activeRun: run(0, ['Bash']) })];
    expect(runningOf(list, 'a1')?.id).toBe('busy');
    expect(runningOf(list, 'a2')).toBeUndefined();
  });

  it('clamps the current step and returns null when not running', () => {
    expect(currentStep(task('x'))).toBeNull();
    expect(currentStep(task('x', { activeRun: run(0, []) }))).toBeNull();
    expect(currentStep(task('x', { activeRun: run(1, ['Read', 'Edit']) }))?.tool).toBe('Edit');
    expect(currentStep(task('x', { activeRun: run(7, ['Read', 'Edit']) }))?.tool).toBe('Edit');
  });

  it('puts a new rank before every task', () => {
    expect(firstRank([])).toBe(-1);
    expect(firstRank([task('a', { rank: 3 }), task('b', { rank: 0 })])).toBe(-1);
    expect(firstRank([task('a', { rank: -4 }), task('b', { rank: 2 })])).toBe(-5);
  });

  it('places a task before another one, or at the end', () => {
    const list = [task('c', { rank: 2 }), task('a', { rank: 0 }), task('b', { rank: 1 })];
    expect(placeBefore(list, list[0], 'a').map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(placeBefore(list, list[1], null).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(placeBefore(list, list[1], 'missing').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    const moved = { ...list[2], status: 'done' as const };
    expect(placeBefore(list, moved, 'a')).toEqual([moved, list[1], list[0]]);
  });

  it('maps run outcomes', () => {
    expect(statusAfterRun({ requiresReview: true })).toBe('review');
    expect(statusAfterRun({ requiresReview: false })).toBe('done');
    expect(spanResult('completed')).toBe('done');
    expect(spanResult('failed')).toBe('fail');
    expect(spanResult('cancelled')).toBe('cancel');
    expect(spanResult('expired')).toBe('cancel');
    expect(subtasksDue(2, 5, 3)).toBe(1);
    expect(subtasksDue(5, 5, 3)).toBe(3);
  });

  it('infers a label from the title and picks its tool script', () => {
    expect(inferLabel('Tóm tắt email sáng nay')).toBe('email');
    expect(inferLabel('Nghiên cứu đối thủ')).toBe('research');
    expect(inferLabel('Deploy staging')).toBe('infra');
    expect(inferLabel('Trả lời khách trên Zalo')).toBe('zalo');
    expect(inferLabel('Chuẩn hoá sheet khách hàng')).toBe('zalo');
    expect(inferLabel('Viết tài liệu API')).toBe('docs');
    expect(inferLabel('Sửa nút đăng nhập')).toBe('fe');
    expect(stepsFor(['research'])).toBe(STEPS.research);
    expect(stepsFor(['unknown'])).toBe(STEPS.fe);
    expect(stepsFor([])).toBe(STEPS.fe);
  });
});
