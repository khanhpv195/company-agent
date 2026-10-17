import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('turns a thrown value into error state', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
    expect(ErrorBoundary.getDerivedStateFromError(undefined).error).toBeInstanceOf(Error);
  });
});
