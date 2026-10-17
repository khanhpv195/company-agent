/**
 * What the simulated agent "does" for a chat message: the tool calls it shows and the reply it
 * streams. Ported as is from the FE mock (apps/fe/src/mocks/chat.ts), including the texts.
 */
export interface ScriptedCall {
  name: string;
  input: string;
  output: string;
}

export const isCodingRequest = (text: string): boolean => /sort|hàm|code|function/i.test(text);

export const toolCallsFor = (text: string): ScriptedCall[] =>
  isCodingRequest(text)
    ? [
        { name: 'Write', input: 'src/utils/sortBy.ts', output: 'Wrote 11 lines' },
        {
          name: 'Bash',
          input: 'pnpm test -- sortBy',
          output:
            '✓ sortBy › single key\n✓ sortBy › multi key\n✓ sortBy › stable\n✓ sortBy › empty\nTests: 4 passed',
        },
      ]
    : [
        { name: 'Bash', input: 'git log --oneline -5', output: '(no commits yet)' },
        {
          name: 'Read',
          input: 'apps/fe/package.json',
          output: '"react": "^19.3.1", "vite": "^8.3.4" …',
        },
      ];

export const replyFor = (text: string): string => {
  if (isCodingRequest(text))
    return 'Em viết hàm sort ổn định theo nhiều khoá, có test kèm theo:\n\n```ts\nexport function sortBy<T>(items: T[], ...keys: ((x: T) => string | number)[]) {\n  return [...items].sort((a, b) => {\n    for (const k of keys) {\n      const d = k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;\n      if (d) return d;\n    }\n    return 0;\n  });\n}\n```\n\nĐã chạy `pnpm test`: **4/4 pass**. Anh/chị muốn em commit vào nhánh mới không?';
  return 'Em đã xem qua repo và lịch sử gần đây. Tóm tắt nhanh:\n\n1. **apps/fe** là Tauri 2 + React 19, đã có UI workspace chạy trên mock.\n2. **apps/be** là NestJS 12 + TypeORM 1, healthcheck chạy ổn.\n3. Chưa có commit nào trên `main`.\n\nBước tiếp theo em đề xuất là làm API thật cho rooms và tasks. Anh/chị muốn em bắt đầu luôn không?';
};

export const CHAT_FAIL_RATE = 0.08;
export const CHAT_FAIL_ERROR = 'Claude Code thoát với mã 1 (context quá dài)';
export const CHAT_STEP_MS = 450;
export const CHAT_OFFLINE_MS = 1200;
export const CHAT_TOOL_MS = 900;
export const CHAT_CHUNK_MS = 28;
/** Duration reported for every simulated chat run (the mock's fixed 4 s). */
export const CHAT_RUN_SECONDS = 4;
