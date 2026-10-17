import { buildAppLink, inviteMail, resetPasswordMail, verifyEmailMail } from './templates';

const input = { name: 'Ada <b>', appUrl: 'http://localhost:1420/', token: 'tok_en-123' };

describe('mail templates', () => {
  it('builds hash-route links from APP_URL, without a doubled slash', () => {
    expect(buildAppLink('http://localhost:1420/', 'reset-password', 'abc')).toBe(
      'http://localhost:1420/#/reset-password?token=abc',
    );
  });

  it.each([
    ['en', 'Reset your password'],
    ['vi', 'Đặt lại mật khẩu'],
    ['fr', 'Reset your password'],
  ])('reset mail in %s', (language, subject) => {
    const mail = resetPasswordMail(language, input);
    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain('http://localhost:1420/#/reset-password?token=tok_en-123');
    // The raw token is printed as a code as well.
    expect(mail.text).toMatch(/: tok_en-123$/m);
    expect(mail.html).toContain('<code>tok_en-123</code>');
  });

  it('escapes user text in the html part only', () => {
    const mail = verifyEmailMail('en', input);
    expect(mail.html).toContain('Hi Ada &lt;b&gt;,');
    expect(mail.html).not.toContain('<b>');
    expect(mail.text).toContain('Hi Ada <b>,');
    expect(mail.text).toContain('#/verify-email?token=');
  });

  it('invite mail names the inviter and workspace and links to /invite', () => {
    const mail = inviteMail('vi', {
      inviterName: 'Khanh',
      workspaceName: 'Holatech',
      appUrl: 'http://localhost:1420',
      token: 't1',
    });
    expect(mail.subject).toBe('Khanh đã mời bạn vào Holatech');
    expect(mail.text).toContain('http://localhost:1420/#/invite?token=t1');
  });
});
