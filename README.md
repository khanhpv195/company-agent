# Monorepo — NestJS + Tauri

Backend REST (NestJS 12) và ứng dụng desktop (Tauri v2 + React) dùng chung type qua `@repo/shared`. Docker chỉ chạy API và PostgreSQL; frontend là app desktop nên không đưa vào image.

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

## Biến môi trường

### Backend — `apps/be/.env`

| Biến                | Mặc định                                                         | Ý nghĩa                                                                                 |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `development`                                                    | `development` \| `production` \| `test`                                                 |
| `PORT`              | `3000`                                                           | Port HTTP                                                                               |
| `CORS_ORIGINS`      | `tauri://localhost,http://tauri.localhost,http://localhost:1420` | Origin được phép (Tauri macOS/Linux, Tauri Windows, Vite)                               |
| `JWT_ACCESS_SECRET` | _(bắt buộc, >= 32 ký tự)_                                        | Tạo bằng `openssl rand -base64 48`. Giá trị trong `.env.example` chỉ là placeholder     |
| `SEED_PASSWORD`     | `password123` (ngoài production)                                 | Mật khẩu của các user seed. Bắt buộc khi `NODE_ENV=production`                          |
| `AGENT_SIMULATOR`   | `false`                                                          | `true` chạy simulator thay cho daemon máy thật. `.env.example` và docker dev đặt `true` |
| `SWAGGER_ENABLED`   | `true`                                                           | Tắt bằng `false` nếu không muốn `/docs`                                                 |
| `FALLBACK_LANGUAGE` | `en`                                                             | `en` \| `vi` — khi thiếu header `Accept-Language`                                       |
| `DB_HOST`           | `localhost`                                                      | Trong Compose đặt thành `postgres`                                                      |
| `DB_PORT`           | `5432`                                                           |                                                                                         |
| `DB_USERNAME`       | _(bắt buộc)_                                                     |                                                                                         |
| `DB_PASSWORD`       | _(bắt buộc, được phép rỗng)_                                     | Compose prod **không** có default — phải truyền                                         |
| `DB_NAME`           | _(bắt buộc)_                                                     |                                                                                         |
| `DB_LOGGING`        | `false`                                                          | Log SQL TypeORM                                                                         |
| `DB_SYNCHRONIZE`    | `false`                                                          | Bị từ chối khi `NODE_ENV=production`. Dùng migration                                    |
| `RUN_MIGRATIONS`    | `true` (runtime entrypoint)                                      | Chạy `migration:run` trước `node dist/main.js`                                          |
| `RUN_SEED`          | `false` (runtime); `true` trong `docker/be.dev.env`              | Chạy `scripts/seed.sh` sau migration lúc container start (seed idempotent)              |

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
- `docker-compose.prod.yml` — image `runtime` (user `node`, `HEALTHCHECK` gọi `/api/v1/health`), **không** mount source. Entrypoint chạy migration (và seed nếu `RUN_SEED=true`). Bắt buộc `DB_PASSWORD` và `JWT_ACCESS_SECRET`.

```bash
# production-like local
DB_PASSWORD=secret docker compose -f docker-compose.prod.yml up -d --build
```

Image multi-stage (`apps/be/Dockerfile`): `turbo prune be --docker` → install → build → `pnpm deploy` → runtime non-root.

## API

|          |                                                                                             |
| -------- | ------------------------------------------------------------------------------------------- |
| Prefix   | `/api` + URI version `/v1`                                                                  |
| Health   | `GET /api/v1/health` → `{ status: "ok", uptime }`                                           |
| Auth     | `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout` (JWT Bearer cho phần còn lại) |
| Realtime | `GET /api/v1/events` (Server-Sent Events, ping định kỳ theo `SSE_HEARTBEAT_MS`)             |
| Envelope | `{ success, data, message, meta? }`                                                         |
| i18n     | Header `Accept-Language: en` hoặc `vi`                                                      |
| Swagger  | http://localhost:3000/docs                                                                  |

## Debug backend

Mở folder `apps/be` trong VS Code/Cursor: launch **Debug Nest (watch)** hoặc **Attach to Nest (port 9229)** (port này được expose bởi Compose dev).
