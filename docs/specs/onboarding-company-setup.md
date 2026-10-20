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

- Kết nối máy trước, chat sau.
- Skill sửa được, user tuỳ biến theo công ty.
- Phòng ban gồm cả nhân viên người lẫn agent.
- Trợ lý thiết lập dùng **Jev** (model ra quyết định của TypeSafe) để điều phối từng lượt chat;
  chỉ gọi Claude khi Jev quyết định là cần (mục 5.7). Product owner tự mua Jev và cấp key; URL
  nhà cung cấp để trong cấu hình, không viết cứng.
- Nhân viên (member) được tạo skill (quyền chi tiết ở mục 6).

Không làm trong spec này: sơ đồ tổ chức nhiều cấp (phòng ban con), phân quyền theo phòng ban,
marketplace skill công khai, LLM sinh văn bản phía server (server chỉ gọi Jev để ra quyết định).

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
| `created_by_member_id`                   | uuid FK members, nullable | người tạo; null với skill tạo từ onboarding/migration                |
| `updated_by_member_id`                   | uuid FK members, nullable | người sửa gần nhất, hiện trên UI cạnh `version`                      |
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

- agent **Trợ lý thiết lập** trên máy đó, persona riêng (mục 5.5), không có skill, `system = true`
  (cột mới trên `agents`; agent system không tính vào danh sách nhân viên, không có phòng ban).
  Tin nhắn gửi cho nó **không** tự đi thẳng xuống máy như agent thường: backend điều phối bằng Jev
  trước (mục 5.7), và chỉ tạo assignment cho máy khi Jev chọn nhánh Claude;
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

### 5.7 Điều phối bằng Jev

**Jev là gì.** Model ra quyết định của TypeSafe. Đầu vào là một `state` (văn bản ngữ cảnh) và một
tập câu hỏi có kiểu; đầu ra là câu trả lời có kiểu: **Choice** (chọn một nhãn), **Score** (điểm) và
**Noul** (có/không kèm xác suất). Jev không sinh văn bản. Gọi qua `POST /v1/decisions`, không
stream, giá chỉ tính token đầu vào (vài cent cho một triệu token), độ trễ khoảng 70 đến 500 ms. Bên
cung cấp có thể là TypeSafe trực tiếp hoặc một gateway (AI/ML API, Portkey, ZenMux).

Các thông tin trên lấy từ tài liệu của bên thứ ba. Việc đầu tiên của PR C là một spike dùng key thật
để chốt URL, tên trường của request/response và giới hạn token; spec chỉnh lại theo kết quả spike.

**Vì sao dùng.** Phần lớn lượt chat onboarding là việc phân loại: user đang trả lời câu hỏi nào,
công ty cần phòng ban nào, đã đủ thông tin để đề xuất chưa, có đang sửa đề xuất không. Jev làm việc
đó nhanh, rẻ và cho kết quả có kiểu, nên backend dựng câu trả lời và thẻ đề xuất bằng code xác
định. Claude (chạy trên máy user) chỉ được gọi cho phần cần viết tự do.

**Module mới `modules/routing`.**

- `DecisionClient` (interface) với hàm `decide(state, questions) → answers` có kiểu. Bản thật
  `JevDecisionClient` gọi HTTP; e2e và unit test dùng bản giả (giống `StripeGateway`).
- `SetupOrchestrator`: nhận tin nhắn mới trong DM với Trợ lý thiết lập, chạy dưới khoá workspace,
  quyết định lượt trả lời. Toàn bộ logic chuyển trạng thái là hàm thuần trong
  `packages/shared/src/rules/setup.rules.ts` để FE mock dùng chung.
- Trạng thái hội thoại lưu trong bảng `setup_sessions` (`workspace_id`, `room_id`, `facts jsonb`,
  `step`, `turns`, `claude_turns`, `updated_at`), không suy lại từ lịch sử mỗi lượt.

**Mỗi lượt user nhắn**, backend gọi Jev một lần với `state` gồm: tin nhắn mới, 6 tin gần nhất, các
`facts` đã thu được và danh sách template (tên + mô tả). Bộ câu hỏi:

| Câu hỏi                         | Kiểu   | Nhãn / ý nghĩa                                                                     |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `intent`                        | Choice | `answer`, `edit_proposal`, `confirm`, `question_about_app`, `off_topic`, `other`   |
| `industry`                      | Choice | danh mục ngành cố định (bán lẻ, F&B, dịch vụ, sản xuất, giáo dục, công nghệ, khác) |
| `size`                          | Choice | `1-5`, `6-20`, `21-50`, `50+`, `unknown`                                           |
| `dept:<template>`               | Noul   | mỗi phòng ban mẫu: công ty có cần không                                            |
| `channel:<zalo/facebook/gmail>` | Noul   | user có nhắc dùng kênh này không                                                   |
| `enough_info`                   | Noul   | đã đủ thông tin để đề xuất chưa                                                    |
| `route`                         | Choice | `script` (code tự trả lời) hoặc `claude` (cần viết tự do)                          |

**Bảng quyết định** (hàm thuần, ngưỡng là hằng số trong code):

- `intent = answer`: gộp `facts` (chỉ nhận Noul có xác suất ≥ 0,7). Nếu `enough_info` ≥ 0,7 hoặc đã
  hỏi đủ 4 lượt: dựng thẻ đề xuất từ template; ngược lại hỏi câu kịch bản tiếp theo còn thiếu (câu
  hỏi là chuỗi i18n `vi`/`en`).
- `intent = edit_proposal` hoặc `confirm`: nhắc user sửa trực tiếp trên thẻ hoặc bấm Tạo đội ngũ.
  Trợ lý không tự áp dụng.
- `route = claude`, hoặc `intent` là `question_about_app`/`other`: tạo assignment chat bình thường
  cho Trợ lý thiết lập trên máy user, với brief có thêm `facts` hiện tại. Claude được dùng tool
  `list_templates`, `list_setup`, `propose_setup` như mục 5.2.
- `intent = off_topic`: câu kịch bản lái về việc thiết lập.

**Giới hạn và dự phòng.**

- Tối đa 20 lượt Jev và 5 lượt Claude cho một phiên thiết lập; vượt thì dừng hỏi, đưa thẻ đề xuất
  theo `facts` hiện có.
- Jev lỗi, quá 3 giây, hoặc chưa cấu hình key: chuyển sang nhánh Claude như mục 5.1 (hành vi cũ).
  Không bao giờ chặn onboarding vì Jev.
- Mỗi lần gọi ghi một dòng `routing_decisions` (workspace, phiên, câu hỏi, câu trả lời, độ trễ, số
  token, nhánh đã chọn) để đo tỉ lệ dùng Claude và chỉnh ngưỡng. Không lưu key, xoá theo
  `RETENTION_ENABLED` như audit.

**Cấu hình** (`config/routing.config.ts`, kiểm tra trong `env.validation.ts`):

| Biến              | Mặc định                              | Ghi chú                                                                    |
| ----------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `ROUTER_PROVIDER` | `none`                                | `none` hoặc `jev`; `none` = luôn đi nhánh Claude                           |
| `JEV_API_KEY`     | trống                                 | bắt buộc khi `ROUTER_PROVIDER=jev`; secret, không log, không trả về client |
| `JEV_BASE_URL`    | URL của nhà cung cấp chốt sau spike   |                                                                            |
| `JEV_MODEL`       | phiên bản cố định, ví dụ `jev-1.13.0` | không dùng `jev-latest`, để kết quả ổn định                                |
| `JEV_TIMEOUT_MS`  | `3000`                                |                                                                            |

Thêm vào `.env.example`, `docker/be.dev.env`, `docker-compose.prod.yml`, `docs/deployment.md` và
CLAUDE.md. e2e ép `ROUTER_PROVIDER=none` và test phần điều phối bằng `DecisionClient` giả.

**Quyền riêng tư.** Nội dung chat thiết lập được gửi cho bên cung cấp Jev. Ghi rõ trong điều khoản và
hiển thị một dòng nhỏ ở bước chat ("Tin nhắn thiết lập được xử lý bởi dịch vụ phân loại bên thứ
ba"). Chỉ gửi tin nhắn trong DM thiết lập, không gửi tin nhắn phòng khác.

**Mở rộng sau** (không thuộc spec này): dùng cùng `DecisionClient` để định tuyến tin nhắn trong
phòng ban tới đúng agent, và quyết định một việc có cần chạy Claude hay trả lời bằng mẫu được.

## 6. Quản lý sau onboarding

- **Settings → Đội ngũ** (owner/admin): danh sách phòng ban, thêm/đổi tên/xoá (xoá mềm; người và
  agent về "Chưa phân phòng"), kéo thả thứ tự, gán người/agent.
- **Skill** (mục riêng trên rail, mọi thành viên): danh sách skill kèm người tạo, phiên bản và các
  agent đang dùng; tạo mới, tạo từ template, sửa `name`/`description`/`content` bằng editor markdown
  có xem trước, xoá (chặn nếu agent đang bật skill đó, trả danh sách agent). Mỗi lần lưu tăng
  `version` và ghi audit.
- **Quyền với skill** (product owner chốt: nhân viên được tạo skill):

  | Việc                     | Member                        | Owner/admin |
  | ------------------------ | ----------------------------- | ----------- |
  | Xem mọi skill            | có                            | có          |
  | Tạo skill                | có                            | có          |
  | Sửa, xoá skill           | chỉ skill mình tạo            | mọi skill   |
  | Bật/tắt skill trên agent | agent cùng phòng ban với mình | mọi agent   |

  Lý do giới hạn: skill là hướng dẫn chạy lâu dài trên máy của người khác, ảnh hưởng mọi lần chạy
  sau của agent. Member vẫn chỉ làm được những gì họ đã có thể yêu cầu agent qua chat, nhưng thay
  đổi được ghi lại: khi một skill đang bật trên agent bị sửa, gửi thông báo cho owner/admin và cho
  người phụ trách máy chạy agent đó; lịch sử phiên bản xem được và khôi phục được (`skill_versions`:
  `skill_id`, `version`, `content`, `edited_by`, `created_at`).

- **Trang agent**: bật/tắt skill lấy từ thư viện workspace thay cho catalog cố định.
- **People và rail**: nhóm agent và người theo phòng ban; trang người hiện phòng ban.
- Tool hiện có `create_agent`/`update_agent` nhận thêm `departmentId`; `skills` nhận slug của
  skill trong thư viện.

## 7. API mới (tóm tắt)

| Method                | Path                                                | Quyền                                         |
| --------------------- | --------------------------------------------------- | --------------------------------------------- |
| GET                   | `/departments`                                      | member                                        |
| POST / PATCH / DELETE | `/departments`, `/departments/:id`                  | owner, admin                                  |
| PUT                   | `/members/:id/department`, `/agents/:id/department` | owner, admin                                  |
| GET                   | `/skills`, `/skills/:id`                            | member                                        |
| POST                  | `/skills`                                           | member                                        |
| PATCH / DELETE        | `/skills/:id`                                       | người tạo, owner, admin                       |
| GET / POST            | `/skills/:id/versions`, `/skills/:id/restore`       | member / người tạo, owner, admin              |
| PUT                   | `/agents/:id/skills`                                | owner, admin; member với agent cùng phòng ban |
| GET                   | `/templates`                                        | member                                        |
| POST                  | `/onboarding/setup`                                 | owner, admin                                  |

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

| PR  | Nội dung                                                                                                                                                                  | Độ khó (CLAUDE.md)                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A   | Phòng ban: bảng, API, gán người/agent, room phòng ban, invite có phòng ban, People/rail nhóm theo phòng ban, Settings → Đội ngũ                                           | khó (migration, shared contract)                |
| B   | Thư viện skill: bảng, API, Settings → Skill, trang agent dùng thư viện, migration dữ liệu cũ, daemon cài `SKILL.md`, nội dung skill template                              | khó (migration, daemon, Claude Code)            |
| C   | Onboarding: spike Jev, module `routing` + `SetupOrchestrator`, template, Trợ lý thiết lập, tool `propose_setup`, thẻ đề xuất, `POST /onboarding/setup`, simulator và mock | khó (auth/onboarding, realtime, tích hợp ngoài) |

Mỗi PR có: unit test cho rule thuần, e2e cho API (quyền, idempotent, trùng tên, workspace khác
không thấy), test FE cho logic thẻ đề xuất, test CLI cho đồng bộ skill.

## 10. Câu hỏi còn mở

1. Trợ lý thiết lập có nên **ở lại** làm "trợ lý quản trị" (thêm agent, sửa skill qua chat) thay vì
   lưu trữ sau onboarding không?
2. Nhân viên người có cần thêm trường **chức danh** (ví dụ "Trưởng phòng Kinh doanh") không?
3. Có muốn cho chat thiết lập **trước** khi kết nối máy không? Với Jev, phần hỏi và đề xuất không cần
   máy; chỉ bước Tạo đội ngũ và nhánh Claude mới cần máy.
