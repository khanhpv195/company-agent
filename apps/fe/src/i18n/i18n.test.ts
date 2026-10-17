import { describe, expect, it } from 'vitest';
import { detectLocale, leafKeys, translateWith } from './core';
import { formatRelativeSeconds } from './format';
import { setLanguage, translate } from './index';
import { en } from './messages/en';
import { vi } from './messages/vi';

describe('message catalogs', () => {
  it('have the same key set in vi and en', () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(vi).sort());
  });

  it('have no empty strings', () => {
    for (const catalog of [vi, en])
      for (const key of leafKeys(catalog))
        expect(translateWith('vi', catalog, undefined, key)).not.toBe('');
  });

  it('use the same {placeholders} in both languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of leafKeys(vi)) {
      const a = translateWith('vi', vi, undefined, key);
      const b = translateWith('en', en, undefined, key);
      expect(vars(b), key).toEqual(vars(a));
    }
  });
});

describe('translateWith', () => {
  const catalog = {
    hi: 'Hello {name}, you have {n} items',
    nested: { deep: 'ok' },
    items: { one: '{n} item', other: '{n} items' },
  };

  it('interpolates {vars} and leaves unknown ones', () => {
    expect(translateWith('en', catalog, undefined, 'hi', { name: 'An', n: 2 })).toBe(
      'Hello An, you have 2 items',
    );
    expect(translateWith('en', catalog, undefined, 'hi', { name: 'An' })).toBe(
      'Hello An, you have {n} items',
    );
  });

  it('resolves nested keys, falls back, then returns the key', () => {
    expect(translateWith('en', catalog, undefined, 'nested.deep')).toBe('ok');
    expect(translateWith('en', {}, catalog, 'nested.deep')).toBe('ok');
    expect(translateWith('en', {}, {}, 'missing.key')).toBe('missing.key');
  });

  it('picks the plural form from n', () => {
    expect(translateWith('en', catalog, undefined, 'items', { n: 1 })).toBe('1 item');
    expect(translateWith('en', catalog, undefined, 'items', { n: 0 })).toBe('0 items');
    expect(translateWith('en', catalog, undefined, 'items', { n: 5 })).toBe('5 items');
    // Vietnamese has a single plural category ("other").
    expect(translateWith('vi', catalog, undefined, 'items', { n: 1 })).toBe('1 items');
  });
});

describe('detectLocale', () => {
  it('defaults to vi unless the browser language starts with en', () => {
    expect(detectLocale(null, 'vi-VN')).toBe('vi');
    expect(detectLocale(null, 'fr-FR')).toBe('vi');
    expect(detectLocale(undefined, undefined)).toBe('vi');
    expect(detectLocale(null, 'en-GB')).toBe('en');
  });

  it('prefers a valid stored choice and ignores garbage', () => {
    expect(detectLocale('en', 'vi-VN')).toBe('en');
    expect(detectLocale('vi', 'en-US')).toBe('vi');
    expect(detectLocale('de', 'en-US')).toBe('en');
  });
});

describe('language store', () => {
  it('translate() follows setLanguage and formatters follow the locale', () => {
    setLanguage('vi');
    expect(translate('common.view')).toBe('Xem');
    expect(formatRelativeSeconds(180)).toContain('phút');
    setLanguage('en');
    expect(translate('common.view')).toBe('View');
    expect(formatRelativeSeconds(180)).toContain('minutes');
    setLanguage('vi');
  });
});
