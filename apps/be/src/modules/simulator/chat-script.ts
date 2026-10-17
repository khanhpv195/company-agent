import { SupportedLanguage } from '@repo/shared';

/**
 * What a simulated (demo) agent answers in chat. It cannot do anything, so it says so instead of
 * pretending to work: no scripted tool calls, no canned code.
 */
export const DEMO_REPLIES: Record<SupportedLanguage, string> = {
  [SupportedLanguage.VI]:
    'Mình là agent demo chạy trên máy mô phỏng nên chưa thể thực hiện yêu cầu này. Kết nối một máy tính thật ở mục Máy tính để dùng Claude Code.',
  [SupportedLanguage.EN]:
    'I am a demo agent running on a simulated machine, so I cannot carry out this request yet. Connect a real computer in the Computers section to use Claude Code.',
};

const VIETNAMESE_MARKS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * The reply speaks the language recorded with the request (the member's UI language). Only when
 * none is recorded does a message written with Vietnamese letters get Vietnamese, anything else
 * the server's fallback language.
 */
export const demoReplyFor = (
  text: string,
  fallback: SupportedLanguage,
  lang?: string | null,
): string => {
  const known = lang === SupportedLanguage.VI || lang === SupportedLanguage.EN ? lang : null;
  return (
    DEMO_REPLIES[known ?? (VIETNAMESE_MARKS.test(text) ? SupportedLanguage.VI : fallback)] ??
    DEMO_REPLIES[SupportedLanguage.EN]
  );
};

export const CHAT_STEP_MS = 450;
export const CHAT_OFFLINE_MS = 1200;
export const CHAT_CHUNK_MS = 28;
/** Duration reported for every simulated chat run (the mock's fixed 4 s). */
export const CHAT_RUN_SECONDS = 4;
