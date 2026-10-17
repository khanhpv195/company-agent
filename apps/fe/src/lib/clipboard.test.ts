import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyBySelection, copyText } from './clipboard';

const field = () => ({
  focus: vi.fn(),
  select: vi.fn(),
  setSelectionRange: vi.fn(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the async Clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = vi.fn();
    vi.stubGlobal('document', { execCommand });
    const input = field();

    await expect(copyText('code-1', input as unknown as HTMLInputElement)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('code-1');
    expect(execCommand).not.toHaveBeenCalled();
    expect(input.select).not.toHaveBeenCalled();
  });

  it('falls back to selecting the input when the Clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', { execCommand });
    const input = field();

    await expect(copyText('code-1', input as unknown as HTMLInputElement)).resolves.toBe(true);
    expect(input.focus).toHaveBeenCalled();
    expect(input.select).toHaveBeenCalled();
    expect(input.setSelectionRange).toHaveBeenCalledWith(0, 6);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back when writeText rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.stubGlobal('document', { execCommand: vi.fn(() => true) });
    const input = field();

    await expect(copyText('abc', input as unknown as HTMLInputElement)).resolves.toBe(true);
    expect(input.select).toHaveBeenCalled();
  });

  it('resolves to false when both the Clipboard API and execCommand fail', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.stubGlobal('document', { execCommand: vi.fn(() => false) });

    await expect(copyText('abc', field() as unknown as HTMLInputElement)).resolves.toBe(false);
  });

  it('resolves to false without an input when the Clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', { execCommand });

    await expect(copyText('abc')).resolves.toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });
});

describe('copyBySelection', () => {
  it('returns false when execCommand throws', () => {
    vi.stubGlobal('document', {
      execCommand: vi.fn(() => {
        throw new Error('unsupported');
      }),
    });
    expect(copyBySelection('abc', field() as unknown as HTMLInputElement)).toBe(false);
  });
});
