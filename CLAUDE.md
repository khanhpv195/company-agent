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

- `JwtAuthGuard` verifies the JWT, then loads the member row by `sub` (one primary-key query): a missing or soft-removed member, or a workspace that differs from the token, is a 401, and the role used by `RolesGuard` is the database role, so role changes take effect at once. The access token carries `sid` (the refresh-token family id) so `/me/sessions` can mark the current session; `EventsService.closeMemberStreams` ends a member's SSE streams when they are removed or their sessions are revoked.
- Logging: `nestjs-pino` (`LoggerModule` in `app.module.ts`, params in `common/logging/logger.config.ts`). JSON lines, `LOG_LEVEL`, `pino-pretty` only when `NODE_ENV=development`; `main.ts` does `bufferLogs` + `app.useLogger`. Request id = safe `x-request-id` or a uuid, echoed in the response header and in the error envelope `meta.requestId`; credentials are redacted; `/health*` is not logged. Use Nest's `Logger`, there is no logging interceptor. e2e runs with `LOG_LEVEL=silent`.
- Throttling: three named throttlers in `ThrottlerModule` (`default` = `AUTH_THROTTLE_*`, `api`, `gateway`); each guard (`AuthThrottlerGuard`, `MemberThrottlerGuard`, global `ApiThrottlerGuard`, `GatewayThrottlerGuard` after `ComputerAuthGuard`) applies only its own via `throttlerName`. `ApiThrottlerGuard` (APP_GUARD after JWT/Roles) keys by member id (else IP), one bucket per tracker, and skips `/events`, `/health*`, `/billing/webhook` and `/gateway/*`; the gateway limit is per computer id. Specs lower limits with `test/utils/low-api-throttle-env.ts`; the test env raises them to 100000 so specs can hammer endpoints.
- Production env guards live in `env.validation.ts` (public JWT secrets, `AGENT_SIMULATOR`, empty `DB_PASSWORD`, `CONNECTIONS_MODE=simulated`, `APP_URL`, mail and Stripe settings); `SWAGGER_ENABLED` defaults to false in production. The full env table is `docs/deployment.md`.
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
  - `agents`: agents and their status. `agents.skills` is a jsonb array of enabled skill uuids; `Agent.skills` lists every live library skill with the agent's flag.
  - `skills`: the workspace skill library (`skills`, `skill_versions`; any member creates, creator|owner|admin edits, soft delete blocked with 409 `skills.IN_USE` while an agent has it on) and `PUT /agents/:id/skills` (owner|admin, or a member of the agent's department; max 30 skills, 200 000 characters of content per agent). Templates live in `@repo/shared` `SKILL_TEMPLATES`. Writes run under `WorkspaceLockService`; the gateway sends the enabled ones as `skillDefs` (plus `skills` slugs) in the agent payload.
  - `gateway`: `AgentGatewayService` (assignments offered to and claimed by agents on computers) and `ReconcileService` (marks silent computers offline and expires leases; `RECONCILE_ENABLED`).
  - `events`: `EventsService` and the SSE stream `GET /api/v1/events` (`SSE_HEARTBEAT_MS`).
  - `onboarding`: first-run flow (`cli-status`, `complete`).
  - `daemon`: the gateway HTTP surface for the real CLI daemon under `/api/v1/gateway/*`: pairing (`POST /computers/pairing-codes` for owner|admin, public `POST /gateway/pair` consuming a single-use hashed code), computer API-key auth (`ComputerAuthGuard`, `agk_` keys looked up by sha256 hash, JWTs rejected), computer and assignment heartbeat/claim/accept/progress/result, and the tools API (`POST /gateway/tools/:name`, allowed only while the assignment is running on that computer). Tools run as the requesting member: task runs are capped at member-level tools and cannot assign work to agents; owner|admin-only tools (`create_agent`, `update_agent`) need an owner or admin requester (their `skills` are library slugs; `list_skills` lists them); there are no delete tools.
  - `simulator`: in-process fake computers and agents (chat and task runners) when `AGENT_SIMULATOR=true`.
  - `departments`: departments (name unique ignoring case, icon, rank, soft delete) each with a public channel named from the slug of the name (`Kế toán` -> `ke-toan`, `-2`, `-3` on collision; rename keeps the channel), plus `members`/`agents`/`invites` `department_id` and `title`. Routes: `/departments` CRUD + `PUT /departments/order`, `PUT /members/:id/department|title`, `PUT /agents/:id/department` (writes owner|admin; own title via `PATCH /me`). Every command takes `lockRooms` first; assigning joins the department room and never leaves the old one; deleting clears assignments and keeps the room. Realtime: `departments.changed`. Helpers in `department-access.ts` are shared with `agents` and `team`.
  - `tasks`: task board, run spans, scheduler; `TaskEngineService` (see below).
  - `chat`: rooms, chats, messages, DMs, drafts.
  - `dashboard`: summary and attention items.
  - `connections`: Zalo, Facebook and Gmail connections (catalog, authorize, connect). `CONNECTIONS_MODE=simulated|disabled` (default `simulated`, `disabled` in production): `Connection.availability` is `simulated` or `unavailable`, and `disabled` makes authorize/connect answer 409 `connections.UNAVAILABLE` (disconnect still works).
  - `account`: `/me` routes (profile, password, sessions, email verification resend, delete own account). `audit`: `AuditService.record` (call it inside the transaction where one exists) and `GET /audit-events`. `mail`: `MailService` (`MAIL_TRANSPORT=log|smtp`, in-memory outbox read by e2e, templates per language, `sendSafe` is fire-and-forget). `team`: invites, member role/removal, ownership transfer, workspace rename/delete. `billing`: plans (`PLANS` in shared), limit enforcement (403 `billing.LIMIT_REACHED`) only when `BILLING_LIMITS_ENABLED=true` (default false = no limits, `BillingSummary.limitsEnabled` false, plan UI hidden in the FE; e2e forces it true, `billing-limits-off.e2e-spec.ts` covers off), usage summary, Stripe behind `BILLING_PROVIDER` (`StripeGateway`, faked in e2e; webhook uses the raw body and `stripe_events` for idempotency). `retention`: daily cron deleting dead tokens, old invites, audit events and Stripe events (`RETENTION_ENABLED`, `AUDIT_RETENTION_DAYS`; off in e2e, tests call `RetentionService.run()`).
- Task engine (`modules/tasks`): `TaskEngineService` is the port of the FE `MockBackend` rules (one run per agent, priority queue, auto pick-up, offline computer blocks, review before done) over the shared rules in `@repo/shared`. Every command runs in `WorkspaceLockService.run`: an in-process promise chain per workspace plus one transaction holding `pg_advisory_xact_lock`, so commands, timers and the `assignment.ended` listener never interleave. Realtime events, domain events (`task.run.ended`, `task.approved`) and timers are buffered and fire only after the commit. A run is a gateway assignment (`create` + `offer` joined to the same transaction through the optional `GatewayTx`, with a partial unique index including `offered` as the safety net) plus a `task_runs` row; the engine finalizes it when `assignment.ended` arrives (idempotent), whoever reports the result. Delayed pick-ups go through the injectable `TaskTimers` (and randomness through `Random`) and re-enter the lock; `TaskReconcileService` additionally runs `pickAll` every 5 s. With `AGENT_SIMULATOR=true`, `SimulatorTaskRunner` (an `AgentRunner`) claims/accepts offered task runs of simulated computers, renews leases and advances one random running task every 2.6 s; real (non-simulated) computers are served by the `packages/cli` daemon through `modules/daemon` instead. E2E specs override `TaskTimers` with a manual queue and use `engine.settled()` to wait for queued commands.
- Known Nest 12 workaround: `I18nModule.forRootAsync` needs an explicit `imports: []` (see comment in `app.module.ts`).

### Frontend (`apps/fe`)

- React 19 + TanStack Query + TanStack Router (code-based routes in `src/router.tsx`, hash history so URLs work inside Tauri) + zustand for UI-only state (`src/stores/ui.ts`: toasts, dialogs, task filters).
- Features in `src/features/<name>/`: `*.api.ts` (query/mutation hooks), pure `*.logic.ts`, page components. Screens: dashboard, tasks (board / list / per-agent timeline + drawer), chat, people, computers, connections, settings, auth (login, register, onboarding). Shell in `src/layout/` (rail, ⌘K palette).
- Styling is plain CSS ported from the mockup: `src/styles/app.css` (CSS variables on `:root`). No Tailwind.
- `src/lib/api-client.ts#apiRequest` is the single fetch wrapper: prefixes `VITE_API_URL`, sends `Accept-Language`, unwraps/validates the `ApiResponse` envelope and throws `ApiError` (status `0` = API unreachable). `api.get/post/patch/put/delete` return only `data`. Tokens live in `src/lib/auth-tokens.ts` (localStorage for now). A 401 triggers a single-flight `refreshTokens()` (`/auth/refresh`), and a final 401 goes through one registered handler in `api-client.ts` that ends the session. `/register` (`RegisterPage`) and `/login` are public routes.
- Real API by default (`VITE_MOCK=0` in `.env.example`). Mock mode (`VITE_MOCK=1`): `apiRequest` routes to `src/mocks/server.ts` in-process (no service worker, so it works in Tauri). The pure task rules (one run per agent, priority queue, auto pick-up, offline computer blocks, review before done) live in `packages/shared/src/rules/`, and `src/mocks/backend.ts` is the stateful mock engine built on them; `src/mocks/chat.ts` streams agent replies. Realtime: `src/lib/realtime.ts` has `SseRealtimeClient` (`GET /api/v1/events`, used when not in mock mode) and the mock `RealtimeClient`; `useRealtimeSync` applies the events to the query cache.
- Tests: `pnpm --filter fe test` (Vitest) covers the mock task engine, realtime, api-client and pure logic.
- Tauri shell (`src-tauri/`) is currently a bare builder with no custom commands. Any API origin must be allowed in the CSP `connect-src` in `src-tauri/tauri.conf.json`, and the backend `CORS_ORIGINS` must include `tauri://localhost`, `http://tauri.localhost` (Windows) and `http://localhost:1420`.

### CLI daemon (`packages/cli`, `@agent/cli`)

Node daemon that connects a computer to the workspace and runs its agents on Claude Code through the Claude Agent SDK. Commands from the repo root: `pnpm agent connect --server <url> --code <pairing code> [--start]`, `pnpm agent start`, `pnpm agent status`, `pnpm agent disconnect`. Config lives in `~/.agent/config.json`. Agent runs use `permissionMode: 'dontAsk'` with path-scoped file rules, and its wire types are kept local (not from `@repo/shared`). Tests: `pnpm --filter @agent/cli test` (fetch and the SDK are faked; never call the real Claude API). Details: `packages/cli/README.md`.

### CI and docs

`.github/workflows/ci.yml`: install (`--frozen-lockfile`; pnpm's `minimumReleaseAge` also checks the lockfile, so a dependency published less than a day ago fails CI until it ages or is added to `minimumReleaseAgeExclude`), format check, lint, typecheck, be unit + e2e (Postgres 16 service), fe and cli tests, build, plus a `docker build` of the be `runtime` target. Operator docs: `docs/deployment.md` (env reference, SMTP, Stripe, backups, single-instance limit, upgrades).

### Docker

`docker-compose.yml` = dev (source mounted, `nest start --watch`, debugger on 9229, migrations on start). `docker/be.dev.env` sets `RUN_SEED=true`, so `scripts/seed.sh` also runs on every start (idempotent; dev login `khanhpv@holatech.tech` / `password123`). `docker-compose.prod.yml` = runtime image, requires `DB_PASSWORD`, `JWT_ACCESS_SECRET` and `APP_URL` (plus `SMTP_HOST` and `MAIL_FROM`, since production only sends real mail); it pins `AGENT_SIMULATOR=false` and `CONNECTIONS_MODE=disabled`. `docker/be.dev.env` keeps the demo behaviour (simulator, simulated connections, log mail, no billing). `apps/be/Dockerfile` is multi-stage via `turbo prune be --docker` → `pnpm deploy` → non-root runtime.

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
