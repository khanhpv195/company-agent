import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpenableUrl, openExternal } from './open-external';

describe('isOpenableUrl', () => {
  it('always allows https and mailto, and rejects other schemes', () => {
    for (const tauri of [true, false]) {
      expect(isOpenableUrl('https://x.io', tauri)).toBe(true);
      expect(isOpenableUrl('mailto:a@b.io?subject=x', tauri)).toBe(true);
      expect(isOpenableUrl('javascript:alert(1)', tauri)).toBe(false);
      expect(isOpenableUrl('file:///etc/passwd', tauri)).toBe(false);
      expect(isOpenableUrl('/relative', tauri)).toBe(false);
    }
  });

  it('allows http only for localhost and 127.0.0.1 outside Tauri', () => {
    expect(isOpenableUrl('http://localhost:1420/x', false)).toBe(true);
    expect(isOpenableUrl('http://127.0.0.1:3000', false)).toBe(true);
    expect(isOpenableUrl('http://localhost:1420', true)).toBe(false);
    expect(isOpenableUrl('http://x.io', false)).toBe(false);
    expect(isOpenableUrl('http://x.io', true)).toBe(false);
  });
});

describe('openExternal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses window.open outside Tauri and ignores bad urls', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    openExternal('https://x.io');
    openExternal('javascript:alert(1)');
    openExternal('http://x.io');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://x.io', '_blank', 'noopener');
  });
});
