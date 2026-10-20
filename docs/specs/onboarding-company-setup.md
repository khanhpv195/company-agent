# Spec: Onboarding thiết lập công ty (phòng ban, nhân viên, agent, skill)

Trạng thái: **bản nháp, chờ duyệt**. Chưa có code.

## 1. Mục tiêu

Lần đầu đăng nhập, sau khi kết nối máy, chủ workspace chat với **Trợ lý thiết lập**. Trợ lý hỏi về
công ty rồi đề xuất một sơ đồ: các phòng ban, nhân viên người (mời qua email) và nhân viên agent
(tạo từ template, gắn skill). Chủ workspace sửa đề xuất rồi bấm **Tạo đội ngũ**; hệ thống tạo tất cả
trong một transaction.

Skill là thật và sửa được: mỗi skill là một bộ hướng dẫn `SKILL.md` mà daemon cài cho agent trước
khi chạy. Owner/admin xem, sửa, tạo skill riêng trong app.

Đã chốt với product owner:

- Kết nối máy trước, chat sau (agent chạy trên máy của user, server không gọi AI).
- Skill sửa được, user tuỳ biến theo công ty.
- Phòng ban gồm cả nhân viên người lẫn agent.

Không làm trong spec này: sơ đồ tổ chức nhiều cấp (phòng ban con), phân quyền theo phòng ban,
marketplace skill công khai, server-side AI.

## 2. Hiện trạng (đã kiểm tra trong code)

| Vấn đề                                                                                                              | Chỗ trong code                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Onboarding chỉ có bước ghép máy, rồi `POST /onboarding/complete`                                                    | `features/auth/OnboardingPage.tsx`, `modules/onboarding/onboarding.service.ts` |
| Đăng ký chỉ tạo workspace + owner, không tạo phòng chat nào                                                         | `workspace.service.ts#createWithOwner`                                         |
| Phòng mặc định `all-members` chỉ có trong seed                                                                      | `database/seeds/chat.seed.ts`                                                  |
| Member và Agent không có trường phòng ban                                                                           | `member.entity.ts`, `agent.entity.ts`                                          |
| Skill chỉ là nhãn: catalog cố định 23 id trong `agent-defaults.ts`, daemon nhận `skills: string[]` nhưng không dùng | `daemon-gateway.service.ts:75`, `packages/cli/src/types.ts:14`                 |
| Daemon chạy SDK với `settingSources: []`, `.claude/**` bị chặn ghi                                                  | `packages/cli/src/runner.ts#buildOptions`, `permissions.ts`                    |
| Tin nhắn chỉ có markdown, không có loại "thẻ" có nút                                                                | `chat-message.entity.ts`, `message.interface.ts`                               |
| Tool `post_message` của CLI chỉ nhận `chatId`, `markdown` (backend nhận thêm `roomId`, `parentId`)                  | `packages/cli/src/tools.ts:84`                                                 |

## 3. Mô hình dữ liệu

### 3.1 Phòng ban

Bảng mới `departments`:

| Cột                                      | Kiểu                              | Ghi chú                                              |
| ---------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `id`                                     | uuid                              |                                                      |
| `workspace_id`                           | uuid FK, cascade                  |                                                      |
| `name`                                   | varchar(60)                       | duy nhất trong workspace, không phân biệt hoa thường |
| `icon`                                   | varchar                           | một trong bộ icon FE có sẵn                          |
| `rank`                                   | int                               | thứ tự hiển thị                                      |
| `room_id`                                | uuid FK rooms, nullable, set null | phòng chat của phòng ban                             |
| `template_id`                            | varchar nullable                  | template gốc, để thống kê                            |
| `created_at`, `updated_at`, `deleted_at` |                                   | xoá mềm                                              |

Thêm `department_id uuid NULL` (FK, set null) vào `members`, `agents`, `invites`.
Một người/agent thuộc tối đa một phòng ban. Không có phòng ban = "Chưa phân phòng".

Phòng chat của phòng ban: một channel thường (`kind = 'channel'`, `isPrivate = false`) tên theo
phòng ban (`kinh-doanh`). Khi gán người hoặc agent vào phòng ban, hệ thống thêm họ vào room đó; đổi
phòng ban thì thêm vào room mới, **không** tự xoá khỏi room cũ (tránh mất lịch sử bất ngờ).

### 3.2 Skill

Bảng mới `skills` (thư viện skill của workspace):

| Cột                                      | Kiểu                      | Ghi chú                                                              |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `id`                                     | uuid                      |                                                                      |
| `workspace_id`                           | uuid FK, cascade          |                                                                      |
| `slug`                                   | varchar(64)               | `[a-z0-9-]`, duy nhất trong workspace; là tên thư mục skill trên máy |
| `name`                                   | varchar(80)               | tên hiển thị                                                         |
| `description`                            | varchar(500)              | Claude dựa vào đây để biết khi nào dùng skill                        |
| `content`                                | text, tối đa 20 000 ký tự | phần thân `SKILL.md` (markdown)                                      |
| `template_id`                            | varchar nullable          | skill gốc từ catalog, null nếu user tự tạo                           |
| `version`                                | int                       | tăng mỗi lần sửa                                                     |
| `created_at`, `updated_at`, `deleted_at` |                           |                                                                      |

`agents.skills` (jsonb hiện có) đổi nghĩa: danh sách `{ id: <skill uuid>, enabled }` trỏ vào bảng
`skills`. Migration chuyển đổi dữ liệu cũ (mục 8).

Giới hạn: tối đa 30 skill bật trên một agent; tổng `content` các skill bật của một agent tối đa
200 000 ký tự.

### 3.3 Template (tĩnh, trong `@repo/shared`)

`packages/shared/src/templates/`:

- `SKILL_TEMPLATES`: `{ id, slug, name, description, content }` cho từng skill gốc, tiếng Việt.
- `AGENT_TEMPLATES`: `{ id, name, role, persona, skillTemplateIds[], suggestedConnections[] }`.
- `DEPARTMENT_TEMPLATES`: `{ id, name, icon, agentTemplateIds[] }`.

Bộ khởi đầu:

| Phòng ban  | Agent mẫu             | Skill mẫu                                             |
| ---------- | --------------------- | ----------------------------------------------------- |
| Kinh doanh | Trợ lý bán hàng       | `bao-gia`, `theo-doi-khach-hang`, `xu-ly-email`       |
| Kinh doanh | CSKH Zalo/Facebook    | `tra-loi-khach`, `tom-tat`, `dich`                    |
| Marketing  | Viết content          | `viet-bai`, `tao-anh`, `dich`                         |
| Marketing  | Nghiên cứu thị trường | `nghien-cuu-web`, `doi-thu`, `tom-tat`                |
| Kế toán    | Kế toán               | `doc-hoa-don-pdf`, `phan-tich-excel`, `bao-cao-thang` |
| Nhân sự    | Tuyển dụng            | `loc-cv`, `hen-lich`, `xu-ly-email`                   |
| Hành chính | Thư ký                | `xu-ly-email`, `hen-lich`, `tom-tat-hop`              |
| Kỹ thuật   | Developer             | `review-code`, `viet-test`, `git`                     |

Nội dung `content` của từng skill được viết trong lúc làm (Giai đoạn B), mỗi skill 30 đến 80 dòng:
khi nào dùng, quy trình từng bước, định dạng kết quả, điều không được làm (ví dụ: không gửi tin
cho khách khi chưa có người duyệt).

## 4. Skill chạy thật trên máy

Payload assignment gửi cho daemon (`GatewayAgent`) đổi `skills: string[]` thành:

```ts
skills: {
  slug: string;
  name: string;
  description: string;
  content: string;
  version: number;
}
[];
```

chỉ gồm skill đang bật. Trước mỗi run, daemon đồng bộ:

1. Ghi `<workdir>/.claude/skills/<slug>/SKILL.md` với frontmatter `name`, `description` và phần
   thân `content`.
2. Xoá các thư mục trong `<workdir>/.claude/skills/` không còn trong danh sách.
3. Bỏ qua ghi nếu file đã đúng `version` (giữ file `.version` cạnh `SKILL.md`).

Daemon tự ghi các file này; agent vẫn bị chặn sửa `.claude/**` như hiện tại. `buildOptions` đổi
`settingSources: []` thành `['project']` và thêm `Skill` vào `allowedTools`, để Claude Agent SDK
nạp skill trong `cwd`.

Cần xác nhận khi làm: `settingSources: ['project']` có nạp thêm thứ gì khác ngoài skill (ví dụ
`.claude/settings.json`, `CLAUDE.md` trong workdir) không. Workdir do daemon tạo trong
`~/.agent/agents/` và agent không ghi được `.claude/`, nên rủi ro thấp; nếu SDK cho phép nạp riêng
skill thì dùng cách hẹp hơn. Test CLI dùng SDK giả như hiện tại, không gọi Claude thật.

Daemon cũ (không biết payload mới) vẫn chạy được: backend gửi thêm trường `skillIds: string[]`
giống cũ trong một phiên bản chuyển tiếp.

## 5. Luồng onboarding

```
Đăng ký → Kết nối máy (đã có) → Chat với Trợ lý thiết lập → Thẻ đề xuất → Tạo đội ngũ → Vào app
```

### 5.1 Trợ lý thiết lập

Khi `cli-status` báo máy đầu tiên đã kết nối và workspace chưa onboard, backend tạo (idempotent,
dưới khoá workspace):

- agent **Trợ lý thiết lập** trên máy đó, persona riêng (mục 5.4), không có skill, `system = true`
  (cột mới trên `agents`; agent system không tính vào danh sách nhân viên, không có phòng ban);
- phòng mặc định `all-members` (nếu chưa có), thêm owner vào;
- DM giữa owner và Trợ lý thiết lập, kèm tin nhắn chào đầu tiên.

Trang onboarding bước 4 hiện DM đó: tái dùng component chat hiện có, khung gọn. Nút "Bỏ qua" vẫn
còn; bỏ qua thì gọi `POST /onboarding/complete` như cũ.

Sau khi onboard xong, Trợ lý thiết lập bị lưu trữ (xoá mềm). Owner/admin có thể chạy lại từ
Settings → Đội ngũ → "Thiết lập lại với trợ lý"; khi đó nó chỉ **thêm** phòng ban/agent mới, không xoá
cái có sẵn.

### 5.2 Tool cho Trợ lý thiết lập

Thêm vào `gateway-tools.service.ts` (chỉ agent `system` gọi được, requester phải là owner/admin):

| Tool             | Quyền  | Việc                                                                     |
| ---------------- | ------ | ------------------------------------------------------------------------ |
| `list_templates` | read   | trả `DEPARTMENT_TEMPLATES`, `AGENT_TEMPLATES`, tên và mô tả skill        |
| `list_setup`     | read   | phòng ban, nhân viên, agent, skill đang có (để chạy lại không tạo trùng) |
| `propose_setup`  | member | đăng một **thẻ đề xuất** vào DM hiện tại (mục 5.3). Không tạo gì.        |

Không có tool nào tự áp dụng đề xuất. Chỉ người bấm nút mới tạo.

### 5.3 Thẻ đề xuất

Thêm cột `card jsonb NULL` vào `chat_messages`, và `card?: MessageCard` vào `Message` trong shared:

```ts
interface SetupProposalCard {
  kind: 'setup_proposal';
  state: 'pending' | 'applied' | 'dismissed';
  departments: {
    key: string; // khoá tạm trong đề xuất
    name: string;
    icon: string;
    templateId: string | null;
    agents: {
      name: string;
      templateId: string | null;
      persona?: string;
      skillTemplateIds: string[];
    }[];
    people: { name: string; email: string; role: 'admin' | 'member' }[];
  }[];
  appliedAt?: string;
}
```

Backend kiểm tra thẻ khi agent gọi `propose_setup`: template id phải tồn tại, tên hợp lệ, email
hợp lệ, tối đa 12 phòng ban, 40 agent, 100 người. Sai thì tool trả lỗi để agent sửa.

FE hiển thị thẻ dạng cây phòng ban, sửa trực tiếp được: đổi tên, bỏ một mục, thêm agent từ template,
bật/tắt skill, thêm người (tên + email). Nút **Tạo đội ngũ** và **Bỏ qua đề xuất**.

### 5.4 Áp dụng: `POST /onboarding/setup`

Owner/admin. Body: `{ messageId, proposal }` (bản đã sửa). Một transaction dưới `WorkspaceLockService`:

1. Kiểm tra thẻ còn `pending` (gọi lại lần hai trả kết quả cũ, idempotent).
2. Tạo skill từ template còn thiếu trong thư viện workspace (theo `template_id`, không tạo trùng).
3. Tạo phòng ban (trùng tên với phòng ban có sẵn thì dùng lại), tạo room của phòng ban.
4. Tạo agent trên máy đã kết nối: persona và skill từ template; tên trùng thì thêm hậu tố ` 2`.
5. Tạo lời mời cho từng người, gắn `department_id`. Email gửi sau commit (`sendSafe`). Người đã là
   thành viên thì chỉ gán phòng ban.
6. Thêm owner, agent của phòng ban vào room phòng ban; thêm mọi agent vào `all-members`.
7. Đổi thẻ sang `applied`, ghi audit `setup.applied` (số phòng ban, agent, lời mời).
8. Đánh dấu workspace đã onboard. Sau commit: phát `agents.changed`, `rooms.changed`,
   `departments.changed`, `message.upserted`.

Trả về tóm tắt; FE chuyển sang dashboard với thông báo "Đã tạo 4 phòng ban, 6 agent, gửi 3 lời
mời".

Khi nhận lời mời, member mới được gán phòng ban từ invite và vào room của phòng ban, cùng với
`joinDefaultRooms` như hiện tại.

### 5.5 Persona của Trợ lý thiết lập

Tiếng Việt (theo ngôn ngữ user), ngắn:

- Hỏi tối đa 4 lượt: ngành nghề và quy mô; các phòng ban; việc lặp lại tốn thời gian; kênh đang
  dùng (Zalo OA, Facebook, Gmail). User trả lời gộp thì bỏ bớt câu hỏi.
- Gọi `list_templates`, chọn template phù hợp, chỉ đề xuất agent cho việc user đã nhắc tới.
- Gọi `propose_setup`, rồi giải thích ngắn vì sao đề xuất như vậy và nhắc user có thể sửa trên thẻ.
- Không hứa tính năng chưa có. Không tự tạo hay mời ai.

### 5.6 Chế độ simulator và mock

- `AGENT_SIMULATOR=true`: Trợ lý thiết lập chạy kịch bản soạn sẵn (hỏi 2 câu, rồi đề xuất bộ Kinh
  doanh + Marketing + Kế toán).
- FE mock (`VITE_MOCK=1`): `mocks/server.ts` và `mocks/chat.ts` có cùng kịch bản và endpoint `setup`.

## 6. Quản lý sau onboarding

- **Settings → Đội ngũ** (owner/admin): danh sách phòng ban, thêm/đổi tên/xoá (xoá mềm; người và
  agent về "Chưa phân phòng"), kéo thả thứ tự, gán người/agent.
- **Settings → Skill** (owner/admin xem và sửa; member chỉ xem): danh sách skill, tạo mới, tạo từ
  template, sửa `name`/`description`/`content` bằng editor markdown có xem trước, xoá (chặn nếu agent
  đang bật skill đó, trả danh sách agent). Mỗi lần lưu tăng `version` và ghi audit.
- **Trang agent**: bật/tắt skill lấy từ thư viện workspace thay cho catalog cố định.
- **People và rail**: nhóm agent và người theo phòng ban; trang người hiện phòng ban.
- Tool hiện có `create_agent`/`update_agent` nhận thêm `departmentId`; `skills` nhận slug của
  skill trong thư viện.

## 7. API mới (tóm tắt)

| Method                | Path                                                | Quyền        |
| --------------------- | --------------------------------------------------- | ------------ |
| GET                   | `/departments`                                      | member       |
| POST / PATCH / DELETE | `/departments`, `/departments/:id`                  | owner, admin |
| PUT                   | `/members/:id/department`, `/agents/:id/department` | owner, admin |
| GET                   | `/skills`, `/skills/:id`                            | member       |
| POST / PATCH / DELETE | `/skills`, `/skills/:id`                            | owner, admin |
| GET                   | `/templates`                                        | member       |
| POST                  | `/onboarding/setup`                                 | owner, admin |

Mọi thông báo lỗi mới có key i18n ở cả `en` và `vi`. Swagger dùng `@ApiWrappedResponse`.

## 8. Migration và tương thích

1. Tạo `departments`, `skills`; thêm `department_id` vào `members`, `agents`, `invites`; thêm
   `system` vào `agents`; thêm `card` vào `chat_messages`.
2. Với mỗi workspace có sẵn: tạo các skill trong thư viện cho mọi id cũ đang được agent dùng (id cũ
   như `web-research` ánh xạ sang skill template tương ứng; id không có template thì tạo skill với
   nội dung ngắn mô tả đúng tên), rồi đổi `agents.skills` sang uuid mới. Migration có `down`.
3. Workspace đã onboard không thấy bước mới; có nút chạy lại ở Settings.
4. Dev seed: thêm phòng ban Kinh doanh, Kỹ thuật, gán các agent và member seed vào.

## 9. Giai đoạn và PR

| PR  | Nội dung                                                                                                                                     | Độ khó (CLAUDE.md)                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A   | Phòng ban: bảng, API, gán người/agent, room phòng ban, invite có phòng ban, People/rail nhóm theo phòng ban, Settings → Đội ngũ              | khó (migration, shared contract)                |
| B   | Thư viện skill: bảng, API, Settings → Skill, trang agent dùng thư viện, migration dữ liệu cũ, daemon cài `SKILL.md`, nội dung skill template | khó (migration, daemon, Claude Code)            |
| C   | Onboarding: template, Trợ lý thiết lập, tool `propose_setup`, thẻ đề xuất, `POST /onboarding/setup`, simulator và mock                       | khó (auth/onboarding, realtime, agent tích hợp) |

Mỗi PR có: unit test cho rule thuần, e2e cho API (quyền, idempotent, trùng tên, workspace khác
không thấy), test FE cho logic thẻ đề xuất, test CLI cho đồng bộ skill.

## 10. Câu hỏi còn mở

1. Trợ lý thiết lập có nên **ở lại** làm "trợ lý quản trị" (thêm agent, sửa skill qua chat) thay vì
   lưu trữ sau onboarding không?
2. Nhân viên người có cần thêm trường **chức danh** (ví dụ "Trưởng phòng Kinh doanh") không?
3. Member thường có được tạo skill riêng không, hay chỉ owner/admin?
