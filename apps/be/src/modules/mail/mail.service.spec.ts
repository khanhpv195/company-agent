import { SupportedLanguage } from '@repo/shared';
import { MailService } from './mail.service';

const make = (outbox = true) =>
  new MailService(
    {
      transport: 'log',
      outbox,
      from: 'x',
      smtp: { host: '', port: 587, secure: false, user: '', pass: '' },
    } as never,
    { appUrl: 'http://localhost:1420' } as never,
    { fallbackLanguage: SupportedLanguage.EN } as never,
  );

describe('MailService (log transport)', () => {
  it('keeps the last 50 messages, oldest first', async () => {
    const mail = make();
    for (let i = 0; i < 55; i++) {
      await mail.send({ to: 'a@example.com', subject: `s${i}`, text: 't', html: 'h' });
    }
    const outbox = mail.outbox();
    expect(outbox).toHaveLength(50);
    expect(outbox[0].subject).toBe('s5');
    expect(outbox[49].subject).toBe('s54');
    mail.clearOutbox();
    expect(mail.outbox()).toHaveLength(0);
  });

  it('keeps no outbox in production', async () => {
    const mail = make(false);
    await mail.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });
    expect(mail.outbox()).toHaveLength(0);
  });

  it('falls back to the configured language outside a request', () => {
    expect(make().language()).toBe('en');
  });
});
