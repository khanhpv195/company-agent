import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SupportedLanguage } from '@repo/shared';
import { I18nContext } from 'nestjs-i18n';
import { createTransport, type Transporter } from 'nodemailer';
import { appConfig, i18nConfig, mailConfig } from '../../config';
import { inviteMail, resetPasswordMail, verifyEmailMail, type MailContent } from './templates';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface OutboxEntry extends MailMessage {
  at: Date;
}

const OUTBOX_SIZE = 50;

/** `ada@example.com` -> `a***@example.com`: logs must not become an address list. */
const redactAddress = (address: string): string => {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly sent: OutboxEntry[] = [];
  private transporter: Transporter | null = null;

  constructor(
    @Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    @Inject(i18nConfig.KEY) private readonly i18n: ConfigType<typeof i18nConfig>,
  ) {}

  /** The last 50 messages of the `log` transport, oldest first; empty in production. */
  outbox(): readonly OutboxEntry[] {
    return [...this.sent];
  }

  clearOutbox(): void {
    this.sent.length = 0;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.config.transport === 'smtp') {
      await this.smtp().sendMail({ from: this.config.from, ...message });
      return;
    }
    if (this.config.outbox) {
      this.sent.push({ ...message, at: new Date() });
      if (this.sent.length > OUTBOX_SIZE) this.sent.shift();
    }
    this.logger.log(`Mail to ${redactAddress(message.to)}: ${message.subject}`);
  }

  /** Fire and forget: a mail failure must not fail (or time) the request that triggered it. */
  sendSafe(to: string, content: MailContent): void {
    this.send({ to, ...content }).catch((error: unknown) =>
      this.logger.warn(`Mail to ${redactAddress(to)} failed: ${String(error)}`),
    );
  }

  /** Language of the current request (`?lang=`, `x-lang`, `Accept-Language`), else the fallback. */
  language(): SupportedLanguage {
    const lang = I18nContext.current()?.lang;
    return lang === SupportedLanguage.VI || lang === SupportedLanguage.EN
      ? lang
      : this.i18n.fallbackLanguage;
  }

  /** `language` is captured by callers that run after the request context is gone. */
  sendResetPassword(
    to: string,
    name: string,
    token: string,
    language: SupportedLanguage = this.language(),
  ): void {
    this.sendSafe(to, resetPasswordMail(language, { name, appUrl: this.app.appUrl, token }));
  }

  sendVerifyEmail(to: string, name: string, token: string): void {
    this.sendSafe(to, verifyEmailMail(this.language(), { name, appUrl: this.app.appUrl, token }));
  }

  sendInvite(to: string, inviterName: string, workspaceName: string, token: string): void {
    this.sendSafe(
      to,
      inviteMail(this.language(), {
        inviterName,
        workspaceName,
        appUrl: this.app.appUrl,
        token,
      }),
    );
  }

  private smtp(): Transporter {
    this.transporter ??= createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      ...(this.config.smtp.user
        ? { auth: { user: this.config.smtp.user, pass: this.config.smtp.pass } }
        : {}),
    });
    return this.transporter;
  }
}
