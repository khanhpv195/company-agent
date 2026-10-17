import { describe, expect, it } from 'vitest';
import { modalStack } from './modal-focus';

describe('modalStack', () => {
  it('only the last pushed modal is on top, and removal reveals the previous one', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    modalStack.push(a);
    modalStack.push(b);
    expect(modalStack.isTop(a)).toBe(false);
    expect(modalStack.isTop(b)).toBe(true);
    modalStack.remove(b);
    expect(modalStack.isTop(a)).toBe(true);
    modalStack.remove(a);
    expect(modalStack.size()).toBe(0);
  });
});
