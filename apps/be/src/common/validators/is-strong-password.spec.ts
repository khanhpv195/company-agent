import { isStrongPassword } from '@repo/shared';

describe('isStrongPassword', () => {
  it.each([
    ['abcdefg1', true],
    ['correct-horse-battery1', true],
    ['mật-khẩu-dài-1', true],
    ['abcdefg', false],
    ['abcdefgh', false],
    ['12345678', false],
    [`a1${'x'.repeat(126)}`, true],
    [`a1${'x'.repeat(127)}`, false],
  ])('%s -> %s', (password, expected) => {
    expect(isStrongPassword(password)).toBe(expected);
  });

  it('rejects the account email, ignoring case and spaces', () => {
    expect(isStrongPassword('ada1@example.com', 'ada1@example.com')).toBe(false);
    expect(isStrongPassword('ADA1@example.com', ' ada1@example.com ')).toBe(false);
    expect(isStrongPassword('ada1@example.com', 'bob1@example.com')).toBe(true);
  });
});
