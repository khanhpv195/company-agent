import { queueOf, runningOf, type Task } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { seed } from '../../mocks/fixtures';
import { applyMention, mentionQuery } from '../chat/chat.logic';
import { filterTasks, moveLocally } from './tasks.logic';

const tasks = (): Task[] => seed(Date.parse('2026-10-16T09:00:00Z')).tasks;

describe('tasks.logic', () => {
  it('finds the running task and the priority-ordered queue', () => {
    const list = tasks();
    expect(runningOf(list, 'a1')?.id).toBe('AG-31');
    expect(queueOf(list, 'a1').map((t) => t.id)).toEqual(['AG-26', 'AG-25']);
  });

  it('filters by assignee, priority and text', () => {
    const list = tasks();
    expect(
      filterTasks(list, { q: '', who: 'a2', prio: '' }).every((t) => t.assigneeId === 'a2'),
    ).toBe(true);
    expect(filterTasks(list, { q: 'ag-27', who: null, prio: '' }).map((t) => t.id)).toEqual([
      'AG-27',
    ]);
    expect(filterTasks(list, { q: '', who: null, prio: 'urgent' }).map((t) => t.id)).toEqual([
      'AG-27',
    ]);
  });

  it('moves a card locally before another card', () => {
    const moved = moveLocally(tasks(), 'AG-22', 'todo', 'AG-26');
    const todo = moved
      .filter((t) => t.status === 'todo')
      .sort((a, b) => a.rank - b.rank)
      .map((t) => t.id);
    expect(todo.indexOf('AG-22')).toBe(todo.indexOf('AG-26') - 1);
  });
});

describe('chat mentions', () => {
  it('detects the mention under the caret', () => {
    expect(mentionQuery('Hello @Rese', 11)).toBe('Rese');
    expect(mentionQuery('Hello world', 11)).toBeNull();
  });
  it('completes the mention and moves the caret after it', () => {
    expect(applyMention('Hi @re rest', 6, 'Research Bot')).toEqual({
      text: 'Hi @Research Bot  rest',
      caret: 17,
    });
  });
});
