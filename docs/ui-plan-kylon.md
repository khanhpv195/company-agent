# Plan: dựng UI giống Kylon (mock data trước)

> **Trạng thái (16/10/2026):** đã triển khai UI thật trong `apps/fe` theo mockup, chạy trên mock backend. Feature `todos` ở FE đã xoá. Khác với plan ban đầu:
> - **Style:** port nguyên CSS của mockup (`src/styles/app.css`) thay vì Tailwind + shadcn, để giữ đúng giao diện đã duyệt.
> - **Mock:** dùng mock in-process (`src/mocks/server.ts`) thay cho MSW. Lý do: service worker không chạy chắc chắn trong WebView của Tauri.
> - **Router:** route khai báo bằng code, dùng hash history. Chưa có prefix `/w/$ws` vì mới có 1 workspace.
> - **Shared types:** đặt ở `packages/shared/src/interfaces/*`, gồm task, room, message, agent, computer, connection, dashboard, realtime-event.
> - **Còn thiếu:** dark mode, virtualized timeline, notification và badge Dock của Tauri, API thật ở BE.

Nguồn: `docs/kylon-reference.md`. Plan cũ `~/.claude/plans/len-ke-hoach-de-valiant-parnas.md` chỉ dùng tham khảo.
Lần này ưu tiên **UI giống Kylon**, chạy hoàn toàn trên **MSW mock**. Phần Paperclip (task board, budget,
approvals, dashboard) để sang phase sau.

## 0. Cần chốt với user trước khi code
1. **Screenshot app.kylon.io**: sidebar, room có agent đang stream, trang agent, computers, onboarding, settings.
   Nếu chưa có thì dựng theo layout Slack-like mặc định dưới đây, rồi chỉnh token màu sau. Nhờ vậy bước này không chặn việc code.
2. Có làm **gọi audio/video** ở V1 không? Đề xuất: chỉ làm nút + UI giả (không làm WebRTC).
3. **Billing**: đề xuất chỉ làm trang plan tĩnh trong Settings.
4. **Ngôn ngữ UI**: đề xuất en mặc định và có vi, vì Kylon dùng tiếng Anh.

## 1. Stack bổ sung cho `apps/fe`
Hiện có: Tauri 2, React 19.3, Vite 8, TanStack Query, `lib/api-client.ts` (bọc `ApiResponse<T>`).

| Mảng | Thêm | Ghi chú |
|---|---|---|
| Router | `@tanstack/react-router` + plugin Vite (file-based) | Route type-safe |
| Style | Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui (Radix) + `lucide-react` | Bỏ `styles.css` hiện tại, dùng CSS variables làm token màu |
| UI state | `zustand` | Workspace đang chọn, panel phải, theme |
| Chat | `react-virtuoso` (timeline), `react-markdown` + `remark-gfm` + `shiki` (code) | |
| Composer | Textarea tự viết + popover @mention (Radix Popover + cmdk) | Không cần editor nặng |
| Palette | `cmdk` | ⌘K để nhảy room/agent |
| Mock | `msw` v2 (browser worker) + `@faker-js/faker` (seed cố định) | Bật khi `VITE_MOCK=1` |
| Test | `vitest` + Testing Library | |

Không thêm thư viện nào khác. Thứ chưa cần thì để sau (dnd-kit, recharts…).

## 2. Hợp đồng type ở `packages/shared/src/interfaces`
Theo pattern của `todo.interface.ts`, enum đặt trong `enums.ts`, export qua `index.ts`.

- `workspace.interface.ts`: `Workspace {id, name, slug, iconUrl?, plan}` và `Member {id, userId, name, avatarUrl, role: owner|admin|member, presence}`
- `computer.interface.ts`: `Computer {id, name, os, hostname, status: online|offline|sleeping, lastHeartbeatAt, keepAwake, cliVersion, agentIds[]}`
- `agent.interface.ts`: `Agent {id, name, avatarUrl, provider: 'claude-code', computerId, persona, skills: AgentSkill[], mcpTools: string[], workdir, status: idle|working|offline}` và `AgentSkill {id, name, description, enabled}`
- `room.interface.ts`: `Room {id, workspaceId, kind: channel|dm, name, topic?, memberIds[], agentIds[], unreadCount, lastMessageAt}`
- `message.interface.ts`: `Message {id, roomId, author: {kind: human|agent, id}, createdAt, status: streaming|complete|failed, parts: MessagePart[], assignmentId?, attachments[]}`
  - `MessagePart = {type:'text', markdown} | {type:'tool_call', id, name, input, output?, status: running|ok|error} | {type:'file', …}`
- `assignment.interface.ts`: `Assignment {id, roomId, agentId, triggerMessageId, status: pending|offered|claimed|running|completed|failed|expired|cancelled, leaseExpiresAt?, startedAt?, finishedAt?, turns, error?}`
- `realtime-event.interface.ts`: union của `message.created`, `message.delta` (append text / cập nhật tool_call), `message.completed`, `assignment.updated`, `computer.status`, `agent.status`, `room.unread`

## 3. Mock layer (`apps/fe/src/mocks`)
- `fixtures/`: 1–2 workspace, 4 member, 2 computer (1 online, 1 offline), 3 agent (dùng ~23 tên skill lấy từ reference), 5 room (#general, #dev, #research, 2 DM), mỗi room khoảng 40 tin, có tool call và code block.
- `db.ts`: store in-memory, có thể mutate. Handler đọc/ghi vào đây để UI thấy thay đổi.
- `handlers/*.ts`: REST theo đường dẫn `/api/v1/...`, khớp `API_URL`, trả `ApiResponse<T>`.
- `realtime/`:
  - interface `RealtimeClient { subscribe(handler): unsubscribe }`
  - `MockRealtime`: khi user gửi tin có `@agent`, chạy kịch bản: tạo assignment `pending → offered → claimed → running` (mỗi bước ~300ms), sau đó stream `message.delta` từng chunk 20–40ms, chèn 1–2 tool_call (`Bash`, `Read`), cuối cùng `completed`. Có 10% ngẫu nhiên `failed` để test UI lỗi.
  - Sau này thay bằng `SseRealtime` gọi BE thật, UI không phải sửa.
- `main.tsx`: `if (import.meta.env.VITE_MOCK === '1') await worker.start()`

## 4. Layout và màn hình
```
┌──┬───────────────┬──────────────────────────────────┬──────────────┐
│WS│ Workspace ▾   │ # dev  · topic          📞 👤 ⓘ │ Right panel  │
│  │ 🔍 Search ⌘K  │──────────────────────────────────│ (thread /    │
│A │ ▾ Rooms       │  timeline (virtuoso)             │  agent info /│
│B │   # general   │   human msg                      │  assignment) │
│+ │   # dev    3  │   agent msg ▸ streaming…         │              │
│  │ ▾ Direct      │     ⚙ tool: Bash  ✓              │              │
│  │   @ Claude    │     ```code```                   │              │
│  │ ▾ Agents      │──────────────────────────────────│              │
│  │   ● Claude    │ [composer: @mention, 📎, send]   │              │
│  │ ▾ Computers   │                                  │              │
│  │   ● MacBook   │                                  │              │
│  │ ⚙ me          │                                  │              │
└──┴───────────────┴──────────────────────────────────┴──────────────┘
```
Rail workspace ~56px, sidebar ~260px, panel phải có thể đóng (~360px).

Routes (TanStack Router, file-based, dưới `src/routes/`):

| Route | Màn hình | Thành phần chính |
|---|---|---|
| `/onboarding/*` | Onboarding 4 bước | Login (nút "Continue in browser", mock deep link) → Tạo/Join workspace → **Connect this computer** (hiện lệnh cài CLI, poll `cli-status` mock đến khi online) → Tạo agent đầu tiên (tên, persona, chọn skill) |
| `/w/$ws/r/$roomId` | Room | `RoomHeader`, `MessageList`, `MessageItem` (human/agent), `AgentStreamingMessage`, `ToolCallCard` (thu gọn/mở rộng input/output), `AssignmentBadge` (trạng thái vòng đời), `Composer` + `MentionPopover`, typing/"Claude is working…" |
| `/w/$ws/agents` | Danh sách agent | Thẻ: avatar, status dot, computer, số skill, nút DM |
| `/w/$ws/agents/$agentId` | Chi tiết agent | Tabs: Overview (provider, computer, workdir), Persona (editor textarea), Skills (toggle list), Activity (assignment gần đây) |
| `/w/$ws/computers` | Computers | Bảng: tên, OS, status, heartbeat ("2s ago"), agent trên máy, keepAwake; nút **Connect a computer** mở dialog hướng dẫn cài CLI |
| `/w/$ws/settings/*` | Settings | Profile, Members (mời, đổi role), Notifications, Billing (plan tĩnh), Desktop (auto-update, upload logs: chỉ UI) |

| `/w/$ws` (mặc định) | Dashboard | Giao việc nhanh, "Đang chạy" (lấy từ task đang chạy), 4 KPI, chart 14 ngày, Cần chú ý, Agents, hoạt động, kênh kết nối |
| `/w/$ws/tasks` | Tasks (cho admin) | Dải "Agents lúc này" (mỗi agent đang làm task nào, timer, số việc chờ). 3 view: **Board** (Backlog / Cần làm / Đang làm (WIP 4) / Chờ duyệt / Xong, kéo thả), **Danh sách** (nhóm theo trạng thái), **Theo Agent** (timeline 8h mỗi run, hàng đợi, % bận, vùng offline). Drawer chi tiết: run đang chạy + log tool, Dừng / Chạy lại / Chạy ngay, Duyệt / Yêu cầu sửa, việc con, lịch sử runs, hoạt động + bình luận. Phím `/` tìm, `c` tạo, `Esc` đóng |
| `/w/$ws/connections` | Kênh kết nối | Zalo, Facebook, Gmail: wizard 3 bước (OAuth mock → chọn tài khoản → route vào room + agent, chế độ nháp/tự gửi) |

Thêm: Command palette ⌘K, theme sáng/tối/hệ thống, toast, empty state và skeleton cho mỗi list.

Mockup tham chiếu: `docs/mockups/ui-preview.html`.

**Luật của Task** (giống Paperclip: một agent chỉ chạy một task cùng lúc, kiểu checkout lock):
- Mỗi agent chỉ có một run tại một thời điểm. Task giao cho agent đang bận sẽ vào hàng đợi, xếp theo độ ưu tiên.
- Agent rảnh tự nhận task kế tiếp. Máy offline thì task bị chặn.
- Task có `review=true` khi xong sẽ sang "Chờ duyệt". "Yêu cầu sửa" sẽ chạy lại với một run mới.
- `Task {id, title, desc, status: backlog|todo|doing|review|done, assigneeId (agent|member), priority, labels[], roomId?, review, subtasks[], runs: Assignment[]}`. Run chính là `Assignment` ở mục 2.

## 5. Cấu trúc thư mục
```
apps/fe/src/
  routes/                 __root.tsx, onboarding/*, w/$ws/{r/$roomId,agents/*,computers,settings/*}
  components/ui/          shadcn (button, dialog, popover, tabs, tooltip, avatar, badge, scroll-area, command, toast)
  components/layout/      AppShell, WorkspaceRail, Sidebar, RightPanel, CommandPalette
  features/
    workspaces/  workspaces.api.ts, useCurrentWorkspace.ts
    rooms/       rooms.api.ts, messages.api.ts, components/*, useRoomStream.ts
    agents/      agents.api.ts, components/*
    computers/   computers.api.ts, components/*
    onboarding/  components/*
    settings/    components/*
  lib/api-client.ts (giữ nguyên), lib/realtime/, lib/query-keys.ts
  stores/ui.ts            zustand
  mocks/                  browser.ts, db.ts, fixtures/, handlers/, realtime/
```
Feature `todos` được giữ lại cho tới khi shell chạy được, xoá ở bước 3.

## 6. Thứ tự làm (mỗi bước đều chạy được)
1. **Shared types + fixtures + MSW**: chạy `pnpm --filter fe dev:web`, thấy request mock trả về đúng trong devtools.
2. **Nền UI**: Tailwind v4, shadcn, design tokens (light/dark), router, zustand.
3. **AppShell**: rail, sidebar có dữ liệu thật từ mock (rooms, DM, agents, computers kèm status dot và unread badge), ⌘K.
4. **Room view tĩnh**: render timeline, markdown, code, tool call card, composer gửi tin của người.
5. **Streaming**: `RealtimeClient` + `MockRealtime`, gõ @mention ra assignment, agent stream dần, cập nhật cache TanStack Query qua `setQueryData`. Đây là phần quan trọng nhất cần làm kỹ.
6. **Agents** (list + detail), **Computers** (list + dialog connect).
7. **Onboarding** 4 bước (nếu user chưa có workspace trong mock thì redirect vào đây).
8. **Settings**.
9. **Phần desktop**: badge dock = tổng unread (`@tauri-apps/api` / plugin), notification khi agent trả lời xong lúc cửa sổ không focus. Deep link để sau.
10. **Đánh bóng**: khớp screenshot Kylon (nếu có), a11y keyboard nav, test.

## 7. Kiểm tra
- `pnpm typecheck && pnpm lint && pnpm --filter fe test`. Có unit test cho: reducer áp `message.delta` vào cache, parse @mention, chuyển trạng thái assignment.
- Chạy tay trên `tauri dev` (port 1420 do session khác đang giữ, nên đi bằng `dev:web` ở port khác hoặc phối hợp với session đó):
  onboarding → vào #dev → gõ `@Claude viết hàm sort` → thấy badge assignment chạy qua các trạng thái → stream text + tool call → completed; tắt computer trong mock thì agent chuyển offline và composer cảnh báo.
- Sau đó mới thêm Playwright trên `vite preview` có MSW.

## 8. Ngoài phạm vi lần này
BE NestJS thật, SSE thật, gateway daemon, WebRTC call, billing thật. Phần Paperclip còn lại (budget, approvals nhiều cấp) để phase sau.
Task board, dashboard và connections đã có trong mockup, làm sau bước 6 với MSW.
