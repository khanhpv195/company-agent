# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

pnpm + Turborepo monorepo: a NestJS REST API (`apps/be`) and a Tauri v2 + React desktop app (`apps/fe`) that share types through `@repo/shared`. Docker runs only the API and PostgreSQL; the frontend is a desktop app and is never containerized.

Current stack (README.md still lists older versions; trust `package.json`): Node 24 (`.nvmrc`), pnpm 11, NestJS 12 (ESM-only packages), TypeORM 1, TypeScript 6, React 19, Vite 8, ESLint 10 (flat config at root `eslint.config.mjs`), Jest 30 for the backend. Rust (rustup stable) is required to run/build the Tauri app.

The product is a Kylon-like "AI-native workspace" (humans and Claude Code agents chatting in rooms, plus a task board where admins see which agent runs what). See `docs/kylon-reference.md` and `docs/ui-plan-kylon.md`. `docs/mockups/ui-preview.html` is the approved static prototype; `apps/fe` implements it for real and talks to the real API by default (`VITE_MOCK=0`). The in-app mock backend (`VITE_MOCK=1`) stays available for UI work without a server and is what the FE task-engine unit tests use. The backend feature modules are listed under Architecture → Backend. Pure task rules live in `packages/shared/src/rules/` (used by the backend task engine and the FE mock); the stateful mock engine is `apps/fe/src/mocks/backend.ts`.

## Commands

Root (Turborepo; most tasks depend on `^build`, so `@repo/shared` is built first):

```bash
pnpm dev                 # be + fe in parallel
pnpm dev:be              # nest start --watch (port 3000)
pnpm dev:fe              # builds @repo/shared, then `tauri dev` (Vite on 1420 + desktop window)
pnpm build | lint | typecheck | test     # test = unit + e2e
pnpm format / format:check               # Prettier
pnpm build:desktop       # Tauri installer (bundles in apps/fe/src-tauri/target/release/bundle/)
pnpm docker:up / docker:down / docker:logs   # postgres + be (dev target, hot reload, migrations on start, seed too when RUN_SEED=true)
pnpm db:migrate / db:seed
```

Frontend in a browser without Tauri: `pnpm --filter fe dev:web`.

Backend tests (Jest needs `NODE_OPTIONS=--experimental-vm-modules` because Nest 12 is ESM-only; the package scripts already set it, so always go through them):

```bash
pnpm --filter be test                                  # unit (*.spec.ts under src/)
pnpm --filter be test <file-pattern>                   # single file by pattern
pnpm --filter be test <file-pattern> -t "<test name>"  # single test by name
pnpm --filter be test:e2e                              # test/*.e2e-spec.ts
```

E2E runs serially against a real Postgres DB `agent_test` (needs `docker compose up -d postgres`). Never run two e2e processes at once: they share and truncate `agent_test`. `test/global-setup.ts` creates it if missing and runs all migrations; `test/setup-env.ts` forces test env (`DB_NAME=agent_test`, fixed `JWT_ACCESS_SECRET`, `AGENT_SIMULATOR=false`) over `.env`. Specs use `createTestApp()` (full `AppModule` + `configureApp`) and `truncateAll(dataSource)` in `beforeEach` from `test/utils`.

Migrations (run from `apps/be`, wrapped by `scripts/migrate.sh`, which uses ts-node in dev and compiled `dist/` when `NODE_ENV=production`):

```bash
pnpm migration:generate CreateNotes   # diff entities -> src/database/migrations/
pnpm migration:create Name | migration:run | migration:revert | migration:show
```

New Nest resource: `cd apps/be && pnpm exec nest g resource modules/<name>`.

Env setup: `cp apps/be/.env.example apps/be/.env` and `cp apps/fe/.env.example apps/fe/.env`. `JWT_ACCESS_SECRET` must be set (>= 32 chars, generate with `openssl rand -base64 48`); the example value is a dev placeholder only. Postgres alone: `docker compose up -d postgres`.

## Architecture

### Shared contract (`packages/shared`)

Types, interfaces and enums used by both apps, built with tsup to CJS + ESM in `dist/`. Consumers import from `dist`, so **after changing shared types run `pnpm --filter @repo/shared build`** (or use `pnpm --filter @repo/shared dev` for watch) before typechecking/running be or fe. `ApiResponse` / `ApiErrorResponse` defined here are the wire format for every endpoint. `src/rules/` holds the pure, framework-free task rules (shared by the FE mock and, later, the backend task engine).

### Backend (`apps/be`)

- Roles are read from the JWT claim, so role changes take effect when the access token is refreshed (at most `JWT_ACCESS_TTL`).
- `main.ts` adds helmet + CORS; `app.setup.ts#configureApp` holds the global HTTP pipeline and is reused by e2e tests, so global pipes/filters/interceptors go there, not in `main.ts`.
- Routes: global prefix `/api` + URI versioning (default `v1`) → `/api/v1/...`. Swagger at `/docs` (`/docs/json`) when `SWAGGER_ENABLED`.
- Response envelope: `TransformResponseInterceptor` wraps every handler result as `{ success, data, message, meta? }`. Controllers return plain entities/values; return a `PaginatedResult` (from `common/dto`) to get `data = items` + `meta`. `@ResponseMessage('<ns>.<KEY>')` sets the i18n message key; the raw-response decorator (`RAW_RESPONSE_KEY`) skips wrapping. Document endpoints with `@ApiWrappedResponse` / `@ApiPaginatedResponse`.
- Errors: `AllExceptionsFilter` produces the error envelope. `ValidationPipe` uses `whitelist` + `transform` and `i18nValidationErrorFactory`, so DTO messages use `i18nValidationMessage(...)`.
- i18n (`nestjs-i18n`): JSON files in `src/i18n/{en,vi}/<namespace>.json`; add keys to both languages. Language resolves from `?lang=`, `x-lang`, then `Accept-Language`, fallback `FALLBACK_LANGUAGE`.
- Config: `src/config/*` registered via `ConfigModule.load`, env validated by Joi (`env.validation.ts`). Constants live in `src/contacts/` (sic, not "constants").
- Database: TypeORM + Postgres. `src/database/data-source.ts` is the standalone DataSource for the CLI and seeds (globs `*.entity` / migrations with the current file extension). `DB_SYNCHRONIZE` is rejected in production; schema changes go through migrations.
- Feature modules live in `src/modules/<name>/` (controller, service, dto, entities, `*.spec.ts`), imported in `app.module.ts`. Current modules:
  - `auth`: register, login, refresh, logout; JWT access tokens and refresh tokens; `/auth/*` is rate-limited (`AUTH_THROTTLE_*`).
  - `workspace`: workspaces, members and the session endpoint.
  - `computers`: computers and their heartbeat/online status.
  - `agents`: agents and their status.
  - `gateway`: `AgentGatewayService` (assignments offered to and claimed by agents on computers) and `ReconcileService` (marks silent computers offline and expires leases; `RECONCILE_ENABLED`).
  - `events`: `EventsService` and the SSE stream `GET /api/v1/events` (`SSE_HEARTBEAT_MS`).
  - `onboarding`: first-run flow (`cli-status`, `complete`).
  - `simulator`: in-process fake computers and agents (chat and task runners) when `AGENT_SIMULATOR=true`.
  - `tasks`: task board, run spans, scheduler; `TaskEngineService` (see below).
  - `chat`: rooms, chats, messages, DMs, drafts.
  - `dashboard`: summary and attention items.
  - `connections`: Zalo, Facebook and Gmail connections (catalog, authorize, connect).
- Task engine (`modules/tasks`): `TaskEngineService` is the port of the FE `MockBackend` rules (one run per agent, priority queue, auto pick-up, offline computer blocks, review before done) over the shared rules in `@repo/shared`. Every command runs in `WorkspaceLockService.run`: an in-process promise chain per workspace plus one transaction holding `pg_advisory_xact_lock`, so commands, timers and the `assignment.ended` listener never interleave. Realtime events, domain events (`task.run.ended`, `task.approved`) and timers are buffered and fire only after the commit. A run is a gateway assignment (`create` + `offer` joined to the same transaction through the optional `GatewayTx`, with a partial unique index including `offered` as the safety net) plus a `task_runs` row; the engine finalizes it when `assignment.ended` arrives (idempotent), whoever reports the result. Delayed pick-ups go through the injectable `TaskTimers` (and randomness through `Random`) and re-enter the lock; `TaskReconcileService` additionally runs `pickAll` every 5 s. With `AGENT_SIMULATOR=true`, `SimulatorTaskRunner` (an `AgentRunner`) claims/accepts offered task runs of simulated computers, renews leases and advances one random running task every 2.6 s; a real daemon replaces it later. E2E specs override `TaskTimers` with a manual queue and use `engine.settled()` to wait for queued commands.
- Known Nest 12 workaround: `I18nModule.forRootAsync` needs an explicit `imports: []` (see comment in `app.module.ts`).

### Frontend (`apps/fe`)

- React 19 + TanStack Query + TanStack Router (code-based routes in `src/router.tsx`, hash history so URLs work inside Tauri) + zustand for UI-only state (`src/stores/ui.ts`: toasts, dialogs, task filters).
- Features in `src/features/<name>/`: `*.api.ts` (query/mutation hooks), pure `*.logic.ts`, page components. Screens: dashboard, tasks (board / list / per-agent timeline + drawer), chat, people, computers, connections, settings, auth (login, register, onboarding). Shell in `src/layout/` (rail, ⌘K palette).
- Styling is plain CSS ported from the mockup: `src/styles/app.css` (CSS variables on `:root`). No Tailwind.
- `src/lib/api-client.ts#apiRequest` is the single fetch wrapper: prefixes `VITE_API_URL`, sends `Accept-Language`, unwraps/validates the `ApiResponse` envelope and throws `ApiError` (status `0` = API unreachable). `api.get/post/patch/put/delete` return only `data`. Tokens live in `src/lib/auth-tokens.ts` (localStorage for now). A 401 triggers a single-flight `refreshTokens()` (`/auth/refresh`), and a final 401 goes through one registered handler in `api-client.ts` that ends the session. `/register` (`RegisterPage`) and `/login` are public routes.
- Real API by default (`VITE_MOCK=0` in `.env.example`). Mock mode (`VITE_MOCK=1`): `apiRequest` routes to `src/mocks/server.ts` in-process (no service worker, so it works in Tauri). The pure task rules (one run per agent, priority queue, auto pick-up, offline computer blocks, review before done) live in `packages/shared/src/rules/`, and `src/mocks/backend.ts` is the stateful mock engine built on them; `src/mocks/chat.ts` streams agent replies. Realtime: `src/lib/realtime.ts` has `SseRealtimeClient` (`GET /api/v1/events`, used when not in mock mode) and the mock `RealtimeClient`; `useRealtimeSync` applies the events to the query cache.
- Tests: `pnpm --filter fe test` (Vitest) covers the mock task engine, realtime, api-client and pure logic.
- Tauri shell (`src-tauri/`) is currently a bare builder with no custom commands. Any API origin must be allowed in the CSP `connect-src` in `src-tauri/tauri.conf.json`, and the backend `CORS_ORIGINS` must include `tauri://localhost`, `http://tauri.localhost` (Windows) and `http://localhost:1420`.

### Docker

`docker-compose.yml` = dev (source mounted, `nest start --watch`, debugger on 9229, migrations on start). `docker/be.dev.env` sets `RUN_SEED=true`, so `scripts/seed.sh` also runs on every start (idempotent; dev login `khanhpv@holatech.tech` / `password123`). `docker-compose.prod.yml` = runtime image, requires `DB_PASSWORD` and `JWT_ACCESS_SECRET`. `apps/be/Dockerfile` is multi-stage via `turbo prune be --docker` → `pnpm deploy` → non-root runtime.

## Model roles and review gate (mandatory)

| Role                                                                                                                                                                | Model                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Specs, implementation plans, plan review                                                                                                                            | Opus 5.5 (`model: "opus"`), never Sonnet or Haiku |
| Codebase scanning and indexing: Explore/research subagents, grep/CodeGraph sweeps, codegraph sync/index refresh, file and caller lookups, log/test-output summaries | Haiku 5.5 (`model: "haiku"`)                      |
| Implementer subagents for routine tasks (per plan task, mechanical edits, renames, copy/i18n, UI wiring, tests for existing behaviour)                              | Haiku 5.5 (`model: "haiku"`)                      |
| Implementer subagents for hard tasks (see below) and fix rounds after the gate                                                                                      | Sonnet 5.5 (`model: "sonnet"`), never Opus        |
| Per-task reviewers and scoped re-reviews                                                                                                                            | Sonnet 5.5                                        |
| Final whole-branch review (the gate)                                                                                                                                | Opus 5.5 (`model: "opus"`)                        |

A task is **hard** (Sonnet 5.5, not Haiku) when it touches the task engine rules (one run per agent, priority queue, auto pick-up, offline-computer blocking, review before done), locking/concurrency, migrations, auth/session guards, SSE/realtime delivery, idempotency, external integrations (Claude Code agents on computers, Zalo/Facebook/Gmail connections, OAuth), Tauri/Rust or CSP/CORS config, a cross-module refactor (including `@repo/shared` contract changes), or root-cause debugging; or when a Haiku implementer fails or stalls on it once. When in doubt, use Sonnet.

Always pass `model` explicitly when dispatching a subagent. The split is fixed: Opus 5.5 plans, Haiku 5.5 scans and executes routine tasks, Sonnet 5.5 executes hard tasks and reviews per task. Opus never implements.
