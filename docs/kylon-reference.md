# Kylon reference (để dựng UI)

Tổng hợp từ phân tích app Kylon cài trên máy (static analysis `app.asar` + config/log trong `~/.kylon`).
Không chứa secret. **Chưa có screenshot UI thật**: Kylon desktop chỉ là vỏ Electron load web
`https://app.kylon.io`, nên layout/màu sắc cụ thể không đọc được từ file cài đặt. Phần "UI" bên dưới
là suy ra từ mô hình dữ liệu + IPC; cần screenshot của user để khớp pixel.

## Sản phẩm là gì

- "AI-native workspace": người và AI agent cùng chat trong **room** (giống Slack). Agent là Claude Code
  chạy trên **computer** (máy thật của user) qua một gateway daemon.
- Vendor: PURE REASON INC. Desktop: Electron, internal name `@p2/desktop`, URL scheme `p2://`.

## Mô hình dữ liệu quan sát được

- **Workspace** → có members (user, auth kiểu Clerk `user_…`), computers, agents, rooms.
- **Computer**: máy đã đăng ký vào workspace (id, online/heartbeat, lifecycle `connected/live`,
  keepAwake). Kết nối SSE tới server, hay reconnect khi máy ngủ dậy.
- **Agent**: tên (vd "<user>'s Claude"), `provider: "claude-code"`, gắn với 1 computer, có persona
  (system prompt "You are an agent on Kylon, an AI-native workspace…"), bộ **skills** (23 skill: browser-use,
  build-app, deploy-app, email-processor, web-research, website-migration…), MCP tools, workdir riêng.
- **Room**: nơi người @mention agent → server tạo **assignment** → daemon claim → chạy Claude Code
  (`--resume` session, `maxTurns`) → stream kết quả về room. Vòng đời assignment:
  `pending → offered → claimed(lease) → running → completed | failed | expired | cancelled`.
- Agent trả lời ngược vào room qua MCP (post message, đọc lịch sử, memory, upload file) bằng token
  ngắn hạn theo lượt (`turn-auth`).

## Tính năng desktop (34 IPC `p2-desktop:*`)

- Onboarding máy local: cài CLI, kiểm tra trạng thái CLI (`cli-install`, `cli-status`, `local-onboarding`)
  → màn "Kết nối máy này làm computer".
- Đăng nhập qua trình duyệt ngoài + deep link callback, ủy quyền kết nối.
- Thanh toán (`prepare-checkout`) → có plan/billing.
- Push notification, **badge số chưa đọc** trên dock, auto-update.
- Gom & upload log để support.
- Quyền camera/micro → có **gọi audio/video** trong room.
- 2 BrowserWindow (main + phụ, có thể là login/onboarding).

## Màn hình suy ra (để dựng UI giống Kylon)

1. **Sidebar trái kiểu Slack**: switch workspace, danh sách Rooms, DM với agent/người, mục Agents, Computers.
2. **Room view**: timeline chat, tin agent stream dần (markdown + code + tool call), composer có @mention
   agent, đính kèm file, nút gọi.
3. **Agent**: danh sách + chi tiết (provider, computer đang chạy, persona, skills, trạng thái, lịch sử việc).
4. **Computers**: online/offline, heartbeat, agent trên máy, hướng dẫn cài CLI/kết nối máy.
5. **Onboarding**: login → tạo/join workspace → kết nối computer → tạo agent đầu tiên.
6. Settings: members, billing, notification.

Phần thêm của mình (không có ở Kylon, lấy ý tưởng Paperclip): Task board/issue có checkout lock,
budget, approvals/inbox, dashboard — xem plan `/Users/holatech/.claude/plans/len-ke-hoach-de-valiant-parnas.md`.
