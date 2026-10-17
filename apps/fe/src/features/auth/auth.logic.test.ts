import { describe, expect, it } from 'vitest';
import { cleanToken, isEmail, isPasswordOk, passwordIssue, safeLegalUrl } from './auth.logic';

describe('passwordIssue', () => {
  it('ignores an empty value', () => expect(passwordIssue('')).toBeNull());
  it('flags length', () => {
    expect(passwordIssue('abc12')).toBe('tooShort');
    expect(passwordIssue('a1'.repeat(70))).toBe('tooLong');
  });
  it('needs a letter and a digit', () => {
    expect(passwordIssue('abcdefgh')).toBe('needLetterDigit');
    expect(passwordIssue('12345678')).toBe('needLetterDigit');
    expect(passwordIssue('abcdefg1')).toBeNull();
  });
  it('rejects the email as password', () => {
    expect(passwordIssue('Me1@x.io', 'me1@x.io')).toBe('sameAsEmail');
  });
  it('isPasswordOk matches', () => {
    expect(isPasswordOk('')).toBe(false);
    expect(isPasswordOk('password1')).toBe(true);
  });
});

describe('helpers', () => {
  it('cleans pasted tokens', () => expect(cleanToken('  ab cd\nef ')).toBe('abcdef'));
  it('validates emails', () => {
    expect(isEmail(' a@b.co ')).toBe(true);
    expect(isEmail('nope')).toBe(false);
  });
  it('only allows http(s) legal urls', () => {
    expect(safeLegalUrl('')).toBeNull();
    expect(safeLegalUrl(undefined)).toBeNull();
    expect(safeLegalUrl('javascript:alert(1)')).toBeNull();
    expect(safeLegalUrl('https://example.com/terms')).toBe('https://example.com/terms');
  });
});
