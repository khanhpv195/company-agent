import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditTarget,
  deviceLabel,
  isProfileNameValid,
  parseUserAgent,
  profilePatch,
  sectionsFor,
  AUDIT_ACTION_KEYS,
} from './settings.logic';
import { en } from '../../i18n/messages/en';
import { translateWith } from '../../i18n';
import type { MessageKey } from '../../i18n';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const TAURI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('parseUserAgent', () => {
  it('reads common browsers', () => {
    expect(parseUserAgent(CHROME_MAC)).toEqual({ browser: 'Chrome', os: 'macOS' });
    expect(parseUserAgent(SAFARI_MAC)).toEqual({ browser: 'Safari', os: 'macOS' });
    expect(
      parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537 Edg/120'),
    ).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko Firefox/127.0')).toEqual(
      {
        browser: 'Firefox',
        os: 'Linux',
      },
    );
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').os).toBe('iOS');
  });
  it('treats a bare WebKit webview on macOS as the desktop shell', () => {
    expect(parseUserAgent(TAURI_MAC)).toEqual({ browser: 'Safari', os: 'macOS' });
  });
  it('handles missing and unknown values', () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(deviceLabel('???')).toBeNull();
    expect(deviceLabel(CHROME_MAC)).toBe('Chrome · macOS');
  });
});

describe('audit labels', () => {
  const t = (key: MessageKey) => translateWith('en', en, en, key);
  it('every mapped action resolves to a real message', () => {
    for (const [action, key] of Object.entries(AUDIT_ACTION_KEYS)) {
      expect(t(key), action).not.toBe(key);
    }
  });
  it('falls back to the raw action', () => {
    expect(auditActionLabel('agent.created', t)).toBe('Agent created');
    expect(auditActionLabel('something.new', t)).toBe('something.new');
  });
  it('describes targets', () => {
    expect(auditTarget({ targetType: 'agent', targetId: 'x', meta: { name: 'Bot' } })).toBe('Bot');
    expect(auditTarget({ targetType: 'computer', targetId: '12345678-aaaa', meta: {} })).toBe(
      'computer 12345678…',
    );
    expect(auditTarget({ targetType: null, targetId: null, meta: {} })).toBe('');
  });
});

describe('settings sections and profile', () => {
  it('hides owner/admin sections from members', () => {
    const ids = (r: 'owner' | 'admin' | 'member' | undefined) => sectionsFor(r).map((s) => s.id);
    expect(ids('member')).toEqual(['profile', 'security', 'appearance', 'members', 'desktop']);
    expect(ids('admin')).toContain('audit');
    expect(ids('owner')).not.toContain('billing'); // plan limits off by default
    expect(sectionsFor('owner', true).map((s) => s.id)).toContain('billing');
    expect(sectionsFor('admin', true).map((s) => s.id)).toContain('billing');
    expect(sectionsFor('member', true).map((s) => s.id)).not.toContain('billing');
    expect(ids(undefined)).not.toContain('audit');
  });
  it('builds a minimal patch', () => {
    const saved = { name: 'Ann', color: null };
    expect(profilePatch(saved, { name: ' Ann ', color: null })).toBeNull();
    expect(profilePatch(saved, { name: 'Bo', color: null })).toEqual({ name: 'Bo' });
    expect(profilePatch(saved, { name: 'Ann', color: '#fff' })).toEqual({ color: '#fff' });
  });
  it('validates the name length', () => {
    expect(isProfileNameValid('  ')).toBe(false);
    expect(isProfileNameValid('a'.repeat(61))).toBe(false);
    expect(isProfileNameValid('ok')).toBe(true);
  });
});
