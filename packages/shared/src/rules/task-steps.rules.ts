import type { TaskStep } from '../interfaces/task.interface';

const step = (tool: string, input: string): TaskStep => ({ tool, input });
/** Tool scripts an agent "runs" for a task, picked by its first label. */
export const STEPS: Record<string, TaskStep[]> = {
  email: [
    step('Bash', 'gws gmail list --unread --since 18:00'),
    step('Read', '42 email · phân loại theo người gửi'),
    step('Bash', 'gws gmail label --add "Cần xử lý" ×3'),
    step('Write', 'summary/email-sang-nay.md'),
    step('Bash', 'agent send --room dm-a1 summary.md'),
  ],
  research: [
    step('WebSearch', '"phần mềm bán hàng" bảng giá 2026'),
    step('WebFetch', 'doithu-a.vn/bang-gia'),
    step('WebFetch', 'doithu-b.vn/pricing'),
    step('Bash', 'python compare.py --out pricing.csv'),
    step('Write', 'reports/doi-thu.md'),
  ],
  fe: [
    step('Read', 'apps/fe/src/App.tsx'),
    step('Grep', '"apiRequest" apps/fe/src'),
    step('Edit', 'apps/fe/src/features/…'),
    step('Bash', 'pnpm --filter fe typecheck'),
    step('Bash', 'pnpm --filter fe test'),
  ],
  be: [
    step('Bash', 'git fetch origin mr/42'),
    step('Read', 'apps/be/src/computers/computers.service.ts'),
    step('Read', 'apps/be/src/computers/computers.controller.ts'),
    step('Bash', 'pnpm --filter be test'),
    step('Write', 'review-mr-42.md'),
  ],
  infra: [
    step('Bash', 'docker compose build be'),
    step('Bash', 'pnpm --filter be migration:run'),
    step('Bash', 'docker compose up -d'),
    step('Bash', 'curl -sf :3000/api/v1/health'),
  ],
  zalo: [
    step('Read', 'Zalo OA · tin nhắn của khách'),
    step('Read', 'bang-gia-combo.xlsx'),
    step('Write', 'bản nháp trả lời'),
  ],
  data: [
    step('Read', 'Khách hàng 2026.xlsx · 1.240 dòng'),
    step('Bash', 'python normalize.py --phone --email'),
    step('Bash', 'python dedupe.py → 37 trùng'),
    step('Write', 'Khách hàng 2026 (chuẩn hoá).xlsx'),
  ],
  docs: [
    step('Read', 'apps/be/src/computers/*.ts'),
    step('Write', 'docs/api/computers.md'),
    step('Bash', 'pnpm lint:md'),
  ],
};
export const stepsFor = (labels: string[]) => STEPS[labels[0]] ?? STEPS.fe;

/** Label for a new task, guessed from its title (picks its tool script). */
export function inferLabel(title: string): string {
  if (/email|mail/i.test(title)) return 'email';
  if (/đối thủ|nghiên cứu|research|tìm/i.test(title)) return 'research';
  if (/deploy|docker|server/i.test(title)) return 'infra';
  if (/zalo|khách/i.test(title)) return 'zalo';
  if (/sheet|data|excel/i.test(title)) return 'data';
  if (/docs|tài liệu|báo cáo/i.test(title)) return 'docs';
  return 'fe';
}
