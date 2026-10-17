import { SupportedLanguage } from '@repo/shared';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `${appUrl}/#/<route>?token=<token>`: hash routing, so the link also opens the desktop app's web build. */
export const buildAppLink = (appUrl: string, route: string, token: string): string =>
  `${appUrl.replace(/\/+$/, '')}/#/${route}?token=${encodeURIComponent(token)}`;

interface Copy {
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  action: string;
  codeLabel: string;
  outro: string;
}

const render = (copy: Copy, name: string, url: string, token: string): MailContent => {
  const greeting = copy.greeting(name);
  const text = [
    greeting,
    '',
    copy.intro,
    '',
    `${copy.action}: ${url}`,
    '',
    `${copy.codeLabel}: ${token}`,
    '',
    copy.outro,
  ].join('\n');
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1c1c1e">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(copy.intro)}</p>` +
    `<p><a href="${escapeHtml(url)}">${escapeHtml(copy.action)}</a></p>` +
    `<p>${escapeHtml(copy.codeLabel)}:<br><code>${escapeHtml(token)}</code></p>` +
    `<p style="color:#6b6b70">${escapeHtml(copy.outro)}</p>` +
    `</div>`;
  return { subject: copy.subject, text, html };
};

const lang = (language: string): SupportedLanguage =>
  language === SupportedLanguage.VI ? SupportedLanguage.VI : SupportedLanguage.EN;

const RESET: Record<SupportedLanguage, Copy> = {
  en: {
    subject: 'Reset your password',
    greeting: (name) => `Hi ${name},`,
    intro: 'We received a request to reset your password. The link works for one hour.',
    action: 'Choose a new password',
    codeLabel: 'Or paste this code into the app',
    outro: 'If you did not ask for this, you can ignore this email.',
  },
  vi: {
    subject: 'Đặt lại mật khẩu',
    greeting: (name) => `Chào ${name},`,
    intro:
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu của bạn. Liên kết có hiệu lực trong 1 giờ.',
    action: 'Chọn mật khẩu mới',
    codeLabel: 'Hoặc dán mã này vào ứng dụng',
    outro: 'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
  },
};

const VERIFY: Record<SupportedLanguage, Copy> = {
  en: {
    subject: 'Verify your email',
    greeting: (name) => `Hi ${name},`,
    intro: 'Confirm that this is your email address. The link works for 7 days.',
    action: 'Verify email',
    codeLabel: 'Or paste this code into the app',
    outro: 'If you did not create an account, you can ignore this email.',
  },
  vi: {
    subject: 'Xác minh email của bạn',
    greeting: (name) => `Chào ${name},`,
    intro: 'Hãy xác nhận đây là địa chỉ email của bạn. Liên kết có hiệu lực trong 7 ngày.',
    action: 'Xác minh email',
    codeLabel: 'Hoặc dán mã này vào ứng dụng',
    outro: 'Nếu bạn không tạo tài khoản, hãy bỏ qua email này.',
  },
};

const INVITE: Record<SupportedLanguage, (inviter: string, workspace: string) => Copy> = {
  en: (inviter, workspace) => ({
    subject: `${inviter} invited you to ${workspace}`,
    greeting: () => 'Hi,',
    intro: `${inviter} invited you to join the workspace "${workspace}". The invite works for 7 days.`,
    action: 'Accept the invite',
    codeLabel: 'Or paste this invite code into the app',
    outro: 'If you were not expecting this, you can ignore this email.',
  }),
  vi: (inviter, workspace) => ({
    subject: `${inviter} đã mời bạn vào ${workspace}`,
    greeting: () => 'Chào bạn,',
    intro: `${inviter} mời bạn tham gia không gian làm việc "${workspace}". Lời mời có hiệu lực trong 7 ngày.`,
    action: 'Chấp nhận lời mời',
    codeLabel: 'Hoặc dán mã mời này vào ứng dụng',
    outro: 'Nếu bạn không mong đợi email này, hãy bỏ qua nó.',
  }),
};

export const resetPasswordMail = (
  language: string,
  input: { name: string; appUrl: string; token: string },
): MailContent =>
  render(
    RESET[lang(language)],
    input.name,
    buildAppLink(input.appUrl, 'reset-password', input.token),
    input.token,
  );

export const verifyEmailMail = (
  language: string,
  input: { name: string; appUrl: string; token: string },
): MailContent =>
  render(
    VERIFY[lang(language)],
    input.name,
    buildAppLink(input.appUrl, 'verify-email', input.token),
    input.token,
  );

export const inviteMail = (
  language: string,
  input: { inviterName: string; workspaceName: string; appUrl: string; token: string },
): MailContent =>
  render(
    INVITE[lang(language)](input.inviterName, input.workspaceName),
    '',
    buildAppLink(input.appUrl, 'invite', input.token),
    input.token,
  );
