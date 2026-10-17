# Monorepo — NestJS + Tauri

Không gian làm việc "AI-native": con người và agent Claude Code chat trong phòng, bảng task cho admin thấy agent nào đang chạy việc gì. Backend REST (NestJS 12) và ứng dụng desktop (Tauri v2 + React 19) dùng chung type qua `@repo/shared`. Docker chỉ chạy API và PostgreSQL; frontend là app desktop nên không đưa vào image.

Stack hiện tại: Node 24, pnpm 11, NestJS 12 (ESM), TypeORM 1, TypeScript 6, React 19, Vite 8, Tauri 2, ESLint 10, Jest 30 (be), Vitest (fe, cli), PostgreSQL 16.

## Tính năng

- **Tài khoản và bảo mật:** đăng ký (đồng ý điều khoản), xác minh email, quên/đặt lại mật khẩu, khoá tạm sau 5 lần sai, danh sách phiên đăng nhập và thu hồi, xoá tài khoản, nhật ký kiểm toán (owner/admin).
- **Nhóm:** mời thành viên bằng link/mã (mail), đổi vai trò, gỡ thành viên, chuyển quyền owner, đổi tên hoặc xoá workspace.
- **Gói và thanh toán:** Free / Pro / Team với giới hạn ghế, agent, máy; thống kê chi phí theo tháng, theo agent, theo ngày; Stripe Checkout + portal (tuỳ chọn, `BILLING_PROVIDER=stripe`).
- **Chat và task:** phòng, DM, thread, nháp trả lời; bảng task (board / list / timeline theo agent), mỗi agent một run, hàng đợi ưu tiên, duyệt trước khi xong.
- **Agent thật:** daemon `packages/cli` chạy agent trên Claude Code ở máy của bạn; máy/agent giả lập (`AGENT_SIMULATOR=true`) chỉ để demo.
- **Kết nối Zalo / Facebook / Gmail:** bản demo (`CONNECTIONS_MODE=simulated`); production tắt (`disabled`) cho tới khi có OAuth thật.
- **Vận hành:** log JSON có request id, `/health` và `/health/ready`, rate limit toàn cục, job dọn dữ liệu hằng ngày, CI GitHub Actions. Xem [`docs/deployment.md`](docs/deployment.md).

```
apps/be          NestJS API  (http://localhost:3000)
apps/fe          Tauri v2 + React + Vite  (port 1420)
packages/shared  Type, interface, enum dùng chung
packages/tsconfig
```

## Prerequisites

| Tool          | Version / ghi chú                                                              |
| ------------- | ------------------------------------------------------------------------------ |
| Node.js       | **24** (xem `.nvmrc`; `engines` yêu cầu `>=24`)                                |
| pnpm          | **11.21.0** (`corepack enable` rồi `corepack prepare pnpm@11.21.0 --activate`) |
| Rust          | `rustup` stable — bắt buộc để `pnpm dev:fe` / build installer                  |
| Docker        | Docker Desktop hoặc engine + Compose v2                                        |
| PostgreSQL 16 | Có sẵn trong `docker compose`; không cần cài local nếu dùng Docker             |

### Dependency hệ thống của Tauri

Cài theo [Tauri v2 — Prerequisites](https://v2.tauri.app/start/prerequisites/). Tóm tắt:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Microsoft C++ Build Tools, WebView2 (thường đã có trên Windows 10/11).
- **Linux (Debian/Ubuntu):** `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.

## Setup — từ lúc clone đến khi app chạy

```bash
git clone <repo-url>
cd <repo>
pnpm install
```

Sao chép biến môi trường (file `.env` đã được gitignore):

```bash
cp apps/be/.env.example apps/be/.env
cp apps/fe/.env.example apps/fe/.env
```

### Cách 1 — Docker cho API + Postgres, Tauri chạy local (khuyên dùng)

```bash
pnpm docker:up          # postgres + be (hot reload). Mỗi lần start: migration, rồi seed (RUN_SEED=true)
pnpm dev:fe             # mở cửa sổ Tauri, gọi API tại VITE_API_URL
```

Đăng nhập bằng tài khoản seed:

- Email: `khanhpv@holatech.tech`
- Mật khẩu: `password123` (đổi bằng `SEED_PASSWORD`)

Tài khoản mới: màn hình `/register` trong app, hoặc `POST /api/v1/auth/register`.

Kiểm tra API:

```bash
curl http://localhost:3000/api/v1/health
# Swagger UI: http://localhost:3000/docs
```

### Cách 2 — Tất cả local (Postgres vẫn qua Docker)

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed            # idempotent: chạy lại an toàn
pnpm dev                # be + fe song song (turbo)
```

Hoặc tách process (nên đặt `AGENT_SIMULATOR=true` trong `apps/be/.env` để có máy/agent giả lập):

```bash
pnpm dev:be             # nest start --watch, port 3000
pnpm dev:fe             # tauri dev (Vite 1420 + cửa sổ desktop)
```

Dừng stack Docker:

```bash
pnpm docker:down
```

### Kết nối máy thật (agent chạy trên Claude Code)

Máy giả lập (`AGENT_SIMULATOR=true`) chỉ để dev UI và demo. Muốn agent chạy thật:

1. Cài và đăng nhập Claude Code trên máy đó (`claude`), hoặc đặt `ANTHROPIC_API_KEY`.
2. Trong app: trang **Computers** → tạo mã ghép đối (dạng `ABCD-EFGH`, hết hạn sau 10 phút, dùng một lần).
3. Từ thư mục gốc repo:

```bash
pnpm --filter @agent/cli build
pnpm agent connect --server http://localhost:3000 --code ABCD-EFGH --start
```

Lần sau chỉ cần `pnpm agent start`. Chi tiết quyền của agent: `packages/cli/README.md`.

## Biến môi trường

### Backend — `apps/be/.env`

Bảng đầy đủ của **mọi** biến (mail, Stripe, giới hạn, log, retention...) nằm ở [`docs/deployment.md`](docs/deployment.md#environment-reference); `apps/be/.env.example` có giá trị mẫu cho dev. Những biến cần biết khi bắt đầu:

| Biến                | Mặc định                  | Ý nghĩa                                                                               |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `development`             | `development` \| `production` \| `test`. Production bật thêm các kiểm tra an toàn     |
| `JWT_ACCESS_SECRET` | _(bắt buộc, >= 32 ký tự)_ | Tạo bằng `openssl rand -base64 48`. Production từ chối giá trị placeholder trong repo |
| `APP_URL`           | `http://localhost:1420`   | Gốc của link trong mail. Bắt buộc ở production                                        |
| `MAIL_TRANSPORT`    | `log`                     | `log` (dev, mail nằm trong bộ nhớ) \| `smtp` (bắt buộc ở production, kèm `SMTP_*`)    |
| `AGENT_SIMULATOR`   | `false`                   | `true` chạy simulator thay cho daemon máy thật (dev). Bị từ chối ở production         |
| `CONNECTIONS_MODE`  | `simulated`               | `simulated` \| `disabled`. Production chỉ nhận `disabled`                             |
| `BILLING_PROVIDER`  | `none`                    | `none` \| `stripe`                                                                    |
| `LOG_LEVEL`         | `info`                    | Log JSON; `pino-pretty` khi `NODE_ENV=development`                                    |
| `DB_*`              | _(xem `.env.example`)_    | `DB_PASSWORD` không được rỗng ở production; `DB_SYNCHRONIZE` bị từ chối ở production  |
| `RUN_MIGRATIONS`    | `true` (runtime)          | Chạy migration trước `node dist/main.js`                                              |
| `RUN_SEED`          | `false`; `true` ở dev     | Seed idempotent lúc container start (chỉ dev)                                         |

### Frontend — `apps/fe/.env`

| Biến           | Mặc định                       | Ý nghĩa                                                                                  |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `VITE_API_URL` | `http://localhost:3000/api/v1` | Base URL API. Phải nằm trong `connect-src` của CSP (`apps/fe/src-tauri/tauri.conf.json`) |
| `VITE_MOCK`    | `0`                            | `0` gọi API thật. `1` dùng mock in-app (`src/mocks`) để làm UI không cần backend         |

### Docker Compose (root)

| Biến       | Mặc định             | Ý nghĩa                              |
| ---------- | -------------------- | ------------------------------------ |
| `BE_PORT`  | `3000`               | Port map ra máy host                 |
| `DB_PORT`  | `5432`               | Port Postgres ra máy host (file dev) |
| `BE_IMAGE` | `monorepo/be:latest` | Image runtime (file prod)            |

## Scripts ở root

| Lệnh                                  | Việc                                      |
| ------------------------------------- | ----------------------------------------- |
| `pnpm dev`                            | Chạy song song `be` và `fe` qua Turborepo |
| `pnpm dev:be`                         | Nest watch                                |
| `pnpm dev:fe`                         | `tauri dev` (build `@repo/shared` trước)  |
| `pnpm build`                          | Build mọi package                         |
| `pnpm build:desktop`                  | Build installer Tauri                     |
| `pnpm lint`                           | ESLint                                    |
| `pnpm typecheck`                      | `tsc --noEmit`                            |
| `pnpm test`                           | Unit test + e2e (backend), Vitest (fe)    |
| `pnpm format`                         | Prettier                                  |
| `pnpm docker:up` / `pnpm docker:down` | Compose dev                               |
| `pnpm db:migrate`                     | `typeorm migration:run`                   |
| `pnpm db:seed`                        | Seed dữ liệu mẫu (idempotent)             |

Trong `apps/be`: `pnpm migration:generate InitX`, `pnpm migration:run`, `pnpm migration:revert`, `pnpm seed`.

Lưu ý e2e backend: chạy tuần tự trên DB `agent_test`, **không chạy hai tiến trình e2e cùng lúc** (chúng cùng truncate DB này).

## Tạo module Nest mới

Từ thư mục backend, dùng Nest CLI (resource nằm đúng `src/modules/`):

```bash
cd apps/be
pnpm exec nest g resource modules/notes
```

CLI tạo `module` / `controller` / `service` / `dto` / `entity`. Sau đó:

1. Khai báo entity TypeORM, viết migration (`pnpm migration:generate CreateNotes`).
2. DTO `class-validator` + `i18nValidationMessage(...)`.
3. Thêm key dịch vào `src/i18n/en/` và `src/i18n/vi/`.
4. Type dùng chung FE/BE thì đặt vào `packages/shared` rồi `pnpm --filter @repo/shared build`.
5. Import module mới trong `app.module.ts` nếu CLI chưa wire.

## Build installer desktop

```bash
pnpm build:desktop
```

Hoặc:

```bash
pnpm --filter @repo/shared build
pnpm --filter fe tauri:build
```

Artifact theo OS:

- **macOS:** `apps/fe/src-tauri/target/release/bundle/dmg/` và `macos/`
- **Windows:** `apps/fe/src-tauri/target/release/bundle/nsis/` (hoặc `msi/`)
- **Linux:** `apps/fe/src-tauri/target/release/bundle/deb/` / `appimage/`

API phải chạy (Docker hoặc `pnpm dev:be`) thì app mới gọi được backend.

## Docker

- `docker-compose.yml` — Postgres 16 (volume + healthcheck) và `be` target `dev`: mount source, `storage/` ra volume, đợi Postgres healthy. CMD chạy migration, seed nếu `RUN_SEED=true`, rồi `nest start --watch`.
- `docker-compose.prod.yml` — image `runtime` (user `node`, `HEALTHCHECK` gọi `/api/v1/health`), **không** mount source. Entrypoint chạy migration. Bắt buộc `DB_PASSWORD`, `JWT_ACCESS_SECRET`, `APP_URL`, cộng `SMTP_HOST` và `MAIL_FROM`. Hướng dẫn đầy đủ (SMTP, Stripe, backup, nâng cấp): [`docs/deployment.md`](docs/deployment.md).

```bash
DB_PASSWORD=... JWT_ACCESS_SECRET=$(openssl rand -base64 48) APP_URL=https://app.example.com \
SMTP_HOST=smtp.example.com MAIL_FROM='App <no-reply@example.com>' \
  docker compose -f docker-compose.prod.yml up -d --build
```

Image multi-stage (`apps/be/Dockerfile`): `turbo prune be --docker` → install → build → `pnpm deploy` → runtime non-root.

## API

|          |                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Prefix   | `/api` + URI version `/v1`                                                                                           |
| Health   | `GET /api/v1/health` (liveness) và `GET /api/v1/health/ready` (kiểm tra DB, 503 khi lỗi)                             |
| Auth     | `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, ... (JWT Bearer cho phần còn lại) |
| Request  | Header `x-request-id` được trả lại; lỗi có `meta.requestId`                                                          |
| Realtime | `GET /api/v1/events` (Server-Sent Events, ping định kỳ theo `SSE_HEARTBEAT_MS`)                                      |
| Envelope | `{ success, data, message, meta? }`                                                                                  |
| i18n     | Header `Accept-Language: en` hoặc `vi`                                                                               |
| Swagger  | http://localhost:3000/docs (mặc định tắt ở production)                                                               |

## Debug backend

Mở folder `apps/be` trong VS Code/Cursor: launch **Debug Nest (watch)** hoặc **Attach to Nest (port 9229)** (port này được expose bởi Compose dev).

## Build the desktop app for production

The desktop app talks to the API configured by `VITE_API_URL`, and the production CSP only allows
that origin. Set it (https is required unless the host is localhost), then build:

```bash
echo 'VITE_API_URL=https://api.example.com/api/v1' > apps/fe/.env.production
pnpm --filter fe tauri:build
```

`tauri:build` first runs `apps/fe/scripts/tauri-prod-config.mjs`, which writes the git-ignored
`apps/fe/src-tauri/tauri.prod.conf.json` (CSP with `connect-src` for that origin) and passes it
to `tauri build --config`. `VITE_API_URL` from the environment overrides the `.env` files. The
backend `CORS_ORIGINS` must include `tauri://localhost` and `http://tauri.localhost`. Installers
land in `apps/fe/src-tauri/target/release/bundle/`.
