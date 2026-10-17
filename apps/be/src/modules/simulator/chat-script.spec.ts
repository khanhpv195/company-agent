import { SupportedLanguage } from '@repo/shared';
import { DEMO_REPLIES, demoReplyFor } from './chat-script';

describe('demoReplyFor', () => {
  it('answers Vietnamese text in Vietnamese whatever the fallback', () => {
    expect(demoReplyFor('viết hàm sortBy giúp em', SupportedLanguage.EN)).toBe(
      DEMO_REPLIES[SupportedLanguage.VI],
    );
  });

  it('uses the fallback language for text without Vietnamese letters', () => {
    expect(demoReplyFor('hello', SupportedLanguage.EN)).toBe(DEMO_REPLIES[SupportedLanguage.EN]);
    expect(demoReplyFor('hello', SupportedLanguage.VI)).toBe(DEMO_REPLIES[SupportedLanguage.VI]);
  });

  it('says it is a demo and never claims to have done work', () => {
    for (const reply of Object.values(DEMO_REPLIES)) expect(reply).toMatch(/demo/i);
    expect(DEMO_REPLIES[SupportedLanguage.VI]).toBe(
      'Mình là agent demo chạy trên máy mô phỏng nên chưa thể thực hiện yêu cầu này. Kết nối một máy tính thật ở mục Máy tính để dùng Claude Code.',
    );
  });
});
