import type { RealtimeEvent } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { MockBackend } from './backend';

function setup(random = 0.99) {
  const pending: (() => void)[] = [];
  const events: RealtimeEvent[] = [];
  const b = new MockBackend({ random: () => random, later: (fn) => void pending.push(fn) });
  b.subscribe((e) => events.push(e));
  const flush = () => {
    while (pending.length) pending.shift()!();
  };
  const notices = () =>
    events.filter((e) => e.type === 'notice').map((e) => (e.type === 'notice' ? e.text : ''));
  /** Run a task's remaining steps until the run ends. */
  const finish = (id: string) => {
    const t = b.task(id);
    while (t.activeRun) b.advance(t);
  };
  return { b, flush, events, notices, finish };
}

describe('MockBackend task rules', () => {
  it('runs at most one task per agent; extra work is queued', () => {
    const { b, notices } = setup();
    expect(b.runningOf('a1')?.id).toBe('AG-31');
    const t = b.task('AG-25');
    b.moveTask(t, 'doing');
    expect(t.status).toBe('todo');
    expect(t.activeRun).toBeNull();
    expect(notices().pop()).toContain('Đã xếp **AG-25** vào hàng đợi');
    expect(b.db.tasks.filter((x) => x.assigneeId === 'a1' && x.activeRun)).toHaveLength(1);
  });

  it('keeps work for an offline computer in todo as blocked', () => {
    const { b } = setup();
    const t = b.task('AG-27');
    t.blockedReason = null;
    b.moveTask(t, 'doing');
    expect(t.status).toBe('todo');
    expect(t.blockedReason).toBe('build-box offline');
    expect(b.agent('a3')?.status).toBe('offline');
  });

  it('orders a queue by priority, then board order', () => {
    const { b } = setup();
    expect(b.queueOf('a1').map((t) => t.id)).toEqual(['AG-26', 'AG-25']);
    b.updateTask(b.task('AG-25'), { priority: 'urgent' });
    expect(b.queueOf('a1').map((t) => t.id)).toEqual(['AG-25', 'AG-26']);
  });

  it('sends a finished task to review when it needs approval, then picks the next one', () => {
    const { b, flush, finish } = setup();
    const t = b.task('AG-30'); // Research Bot, requiresReview
    finish('AG-30');
    expect(t.status).toBe('review');
    expect(t.runs[0].status).toBe('completed');
    expect(t.subtasks.every((s) => s.done)).toBe(true);
    flush();
    expect(b.runningOf('a2')?.id).toBe('AG-24');
  });

  it('goes straight to done without review', () => {
    const { b, finish } = setup();
    finish('AG-31');
    expect(b.task('AG-31').status).toBe('done');
  });

  it('returns a failed run to todo with an error, and the agent skips it', () => {
    const { b, flush, finish } = setup(0);
    finish('AG-31');
    const t = b.task('AG-31');
    expect(t.status).toBe('todo');
    expect(t.error).toMatch(/Run #1 lỗi/);
    expect(t.runs[0].status).toBe('failed');
    flush();
    expect(b.runningOf('a1')?.id).not.toBe('AG-31');
  });

  it('stops a run and lets the agent move on', () => {
    const { b, flush } = setup();
    const t = b.task('AG-31');
    b.stopTask(t);
    expect(t.activeRun).toBeNull();
    expect(t.runs[0].status).toBe('cancelled');
    expect(t.error).toBe('Đã dừng thủ công');
    flush();
    expect(b.runningOf('a1')?.id).toBe('AG-26');
  });

  it('only approves tasks waiting for review', () => {
    const { b } = setup();
    expect(() => b.approveTask(b.task('AG-25'))).toThrow();
    b.approveTask(b.task('AG-29'));
    expect(b.task('AG-29').status).toBe('done');
  });

  it('"run now" jumps the queue as urgent while the agent is busy', () => {
    const { b } = setup();
    const t = b.task('AG-25');
    b.runNow(t);
    expect(t.priority).toBe('urgent');
    expect(b.queueOf('a1')[0].id).toBe('AG-25');
    expect(t.activeRun).toBeNull();
  });

  it('starts a new task right away when its agent is idle', () => {
    const { b, flush } = setup();
    b.stopTask(b.task('AG-31'));
    b.task('AG-26').assigneeId = null;
    b.task('AG-25').assigneeId = null;
    const t = b.createTask({ title: 'Gửi email báo giá', assigneeId: 'a1', status: 'todo' });
    expect(t.labels).toEqual(['email']);
    flush();
    expect(b.runningOf('a1')?.id).toBe(t.id);
  });

  it('pausing the scheduler freezes progress and pick-up', () => {
    const { b, flush } = setup();
    b.setPaused(true);
    const before = b.task('AG-31').activeRun!.step;
    b.tick();
    expect(b.task('AG-31').activeRun!.step).toBe(before);
    b.stopTask(b.task('AG-31'));
    flush();
    expect(b.runningOf('a1')).toBeUndefined();
    b.setPaused(false);
    expect(b.runningOf('a1')?.id).toBe('AG-26');
  });

  it('reassigning a running task cancels its run', () => {
    const { b } = setup();
    const t = b.task('AG-31');
    b.updateTask(t, { assigneeId: 'u2' });
    expect(t.activeRun).toBeNull();
    expect(t.runs[0].status).toBe('cancelled');
    expect(t.assigneeId).toBe('u2');
  });
});

describe('seed data', () => {
  it('does not share mutable arrays between tasks', () => {
    const b = new MockBackend({ later: () => {} });
    const runs = b.db.tasks.map((t) => t.runs);
    expect(new Set(runs).size).toBe(runs.length);
  });
});
