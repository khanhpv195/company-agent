import { ConfigType, registerAs } from '@nestjs/config';

export const mailConfig = registerAs('mail', () => ({
  transport: (process.env.MAIL_TRANSPORT ?? 'log') as 'log' | 'smtp',
  /** The in-memory outbox (read by tests and handy in dev) never exists in production. */
  outbox: process.env.NODE_ENV !== 'production',
  from: process.env.MAIL_FROM ?? 'Agent <no-reply@localhost>',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
}));

export type MailConfig = ConfigType<typeof mailConfig>;
