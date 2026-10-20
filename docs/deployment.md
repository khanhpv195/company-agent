# Deployment guide

How to run the API and PostgreSQL in production. The desktop app is built separately (see
[Desktop app](#desktop-app)) and points at your API URL.

## Overview

- `docker-compose.prod.yml` runs two services: `postgres` (16) and `be` (the `runtime` image of
  `apps/be/Dockerfile`: non-root, tini, health check on `/api/v1/health`).
- The API runs the database migrations on every start (`RUN_MIGRATIONS=true`), so an upgrade is
  "pull the new image, restart".
- Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of port 3000. Desktop clients and Stripe talk to it over https.

```bash
# Put the variables below in a `.env` file next to the compose file (compose reads it),
# or export them from your secret store.
docker compose -f docker-compose.prod.yml up -d --build
curl https://api.example.com/api/v1/health/ready
```

Minimum environment for `docker-compose.prod.yml`: `DB_PASSWORD`, `JWT_ACCESS_SECRET`, `APP_URL`,
`SMTP_HOST`, `MAIL_FROM` (compose refuses to start without the first three).

## Production guards

With `NODE_ENV=production` the API refuses to boot (the Joi validation in
`apps/be/src/config/env.validation.ts` fails with the offending variable) when:

- `JWT_ACCESS_SECRET` is shorter than 32 characters or is one of the public placeholders from the
  repo (`.env.example`, `docker/be.dev.env`: anything containing `change-me` or `dev-only`);
- `AGENT_SIMULATOR=true` (it fakes computers and agents);
- `DB_PASSWORD` is empty, or `DB_SYNCHRONIZE=true`;
- `CONNECTIONS_MODE` is `simulated` (Zalo/Facebook/Gmail OAuth is a demo);
- `MAIL_TRANSPORT` is not `smtp`, or `SMTP_HOST` / `MAIL_FROM` is missing;
- `APP_URL` is missing;
- `BILLING_PROVIDER=stripe` without all four Stripe settings.

Swagger (`/docs`) is off by default in production; set `SWAGGER_ENABLED=true` to expose it.

## Environment reference

Set on the `be` container. "Prod" is what production requires or changes.

| Variable                 | Default                                           | Notes                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `development`                                     | `development`, `production`, `test`. The image sets `production`.                                                                                                                                                                                                    |
| `PORT`                   | `3000`                                            | HTTP port inside the container.                                                                                                                                                                                                                                      |
| `CORS_ORIGINS`           | `tauri://localhost,http://tauri.localhost` (prod) | Comma-separated. Development also allows `http://localhost:1420`. Add your web origin if you serve one.                                                                                                                                                              |
| `SWAGGER_ENABLED`        | `true`, `false` in production                     | Serves `/docs` and `/docs/json`.                                                                                                                                                                                                                                     |
| `TRUST_PROXY`            | `false`                                           | Number of reverse proxies in front of the API (`1` for one), or `true`. **Set it behind a proxy/load balancer**: otherwise every client shares the proxy's address and one rate-limit bucket. Leave `false` when exposed directly (X-Forwarded-For is then ignored). |
| `LOG_LEVEL`              | `info`                                            | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. JSON lines, pretty only when `NODE_ENV=development`.                                                                                                                                                   |
| `FALLBACK_LANGUAGE`      | `en`                                              | `en` or `vi`, used when the request names no language.                                                                                                                                                                                                               |
| `APP_URL`                | `http://localhost:1420`                           | Prod: required. Base of the links in mails (`/#/reset-password`, `/#/verify-email`, `/#/invite`) and Stripe return URLs.                                                                                                                                             |
| `JWT_ACCESS_SECRET`      | required                                          | At least 32 chars, `openssl rand -base64 48`. Rotating it logs everyone out.                                                                                                                                                                                         |
| `JWT_ACCESS_TTL`         | `15m`                                             | `<n>[s\|m\|h\|d]`.                                                                                                                                                                                                                                                   |
| `JWT_REFRESH_TTL`        | `30d`                                             | Same format.                                                                                                                                                                                                                                                         |
| `AUTH_THROTTLE_LIMIT`    | `10`                                              | Requests per `AUTH_THROTTLE_TTL` and address on `/auth/*`, invite accept and `/gateway/pair`; also per member on password routes.                                                                                                                                    |
| `AUTH_THROTTLE_TTL`      | `60s`                                             | Window of the auth limit.                                                                                                                                                                                                                                            |
| `API_THROTTLE_LIMIT`     | `600`                                             | Requests per minute for all other routes, keyed by member id (public routes by address). One bucket per member, not per route.                                                                                                                                       |
| `GATEWAY_THROTTLE_LIMIT` | `1200`                                            | Requests per minute per computer on `/gateway/*` (daemon heartbeat, claim, progress).                                                                                                                                                                                |
| `ARGON2_MEMORY_COST`     | `65536`                                           | KiB. Raise on strong hosts.                                                                                                                                                                                                                                          |
| `ARGON2_TIME_COST`       | `3`                                               | Passes.                                                                                                                                                                                                                                                              |
| `ARGON2_PARALLELISM`     | `4`                                               | Lanes.                                                                                                                                                                                                                                                               |
| `MAIL_TRANSPORT`         | `log`; prod requires `smtp`                       | `log` only writes a redacted line and keeps messages in memory (dev and tests).                                                                                                                                                                                      |
| `MAIL_FROM`              | `Agent <no-reply@localhost>`; prod required       | Sender of every mail, e.g. `Acme <no-reply@acme.com>`.                                                                                                                                                                                                               |
| `SMTP_HOST`              | none; required with `smtp`                        | See [SMTP](#smtp).                                                                                                                                                                                                                                                   |
| `SMTP_PORT`              | `587`                                             |                                                                                                                                                                                                                                                                      |
| `SMTP_SECURE`            | `false`                                           | `true` for implicit TLS (port 465); `false` uses STARTTLS when offered.                                                                                                                                                                                              |
| `SMTP_USER`              | empty                                             |                                                                                                                                                                                                                                                                      |
| `SMTP_PASS`              | empty                                             |                                                                                                                                                                                                                                                                      |
| `BILLING_LIMITS_ENABLED` | `false`                                           | `true` enforces plan limits (seats, agents, computers; 403 `billing.LIMIT_REACHED`) and shows the plan UI. `false`: every workspace gets full functionality, no limits, no plan UI.                                                                                  |
| `BILLING_PROVIDER`       | `none`                                            | `none` or `stripe`. Plan limits follow `BILLING_LIMITS_ENABLED`; with `none` checkout and portal answer 409.                                                                                                                                                         |
| `STRIPE_SECRET_KEY`      | empty; required with `stripe`                     | `sk_live_...`                                                                                                                                                                                                                                                        |
| `STRIPE_WEBHOOK_SECRET`  | empty; required with `stripe`                     | `whsec_...` of the webhook endpoint.                                                                                                                                                                                                                                 |
| `STRIPE_PRICE_PRO`       | empty; required with `stripe`                     | Price id of the Pro plan (monthly, flat).                                                                                                                                                                                                                            |
| `STRIPE_PRICE_TEAM`      | empty; required with `stripe`                     | Price id of the Team plan (monthly, per seat).                                                                                                                                                                                                                       |
| `CONNECTIONS_MODE`       | `simulated`; `disabled` in production             | `disabled` makes provider authorize/connect answer 409 `connections.UNAVAILABLE`; the app shows "coming soon". Only `disabled` in prod.                                                                                                                              |
| `AGENT_SIMULATOR`        | `false`                                           | In-process fake computers and agents for demos. Rejected in production.                                                                                                                                                                                              |
| `RECONCILE_ENABLED`      | `true`                                            | Background loop that marks silent computers offline and expires leases.                                                                                                                                                                                              |
| `SSE_HEARTBEAT_MS`       | `25000`                                           | `: ping` interval on `GET /events`.                                                                                                                                                                                                                                  |
| `RETENTION_ENABLED`      | `true`                                            | Daily cleanup job at 03:00 server time. See [Retention](#retention).                                                                                                                                                                                                 |
| `AUDIT_RETENTION_DAYS`   | `365`                                             | Audit events older than this are deleted.                                                                                                                                                                                                                            |
| `DB_HOST`                | `localhost` (`postgres` in compose)               |                                                                                                                                                                                                                                                                      |
| `DB_PORT`                | `5432`                                            |                                                                                                                                                                                                                                                                      |
| `DB_USERNAME`            | required (`postgres` in compose)                  |                                                                                                                                                                                                                                                                      |
| `DB_PASSWORD`            | required; prod must be non-empty                  |                                                                                                                                                                                                                                                                      |
| `DB_NAME`                | required (`app` in compose)                       |                                                                                                                                                                                                                                                                      |
| `DB_LOGGING`             | `false`                                           | Logs every SQL statement.                                                                                                                                                                                                                                            |
| `DB_SYNCHRONIZE`         | `false`                                           | Rejected in production: schema changes go through migrations.                                                                                                                                                                                                        |
| `SEED_PASSWORD`          | `password123` outside production; min 8 chars     | Only for the seed script, which you do not run in production.                                                                                                                                                                                                        |
| `RUN_MIGRATIONS`         | `true` (entrypoint)                               | Run pending migrations before starting.                                                                                                                                                                                                                              |
| `RUN_SEED`               | `false` (`true` in `docker/be.dev.env`)           | Dev only: seeds `khanhpv@holatech.tech`.                                                                                                                                                                                                                             |
| `BE_PORT`                | `3000`                                            | Compose only: host port.                                                                                                                                                                                                                                             |
| `BE_IMAGE`               | `monorepo/be:latest`                              | Compose only: image to run (set it when you pull from a registry).                                                                                                                                                                                                   |

The desktop app's own variables (`VITE_API_URL`, `VITE_TERMS_URL`, `VITE_PRIVACY_URL`,
`VITE_SALES_EMAIL`, `VITE_MOCK`) live in `apps/fe/.env.example` and are baked in at build time.

## SMTP

Production sends real mail (verification, password reset, invites). Use any SMTP relay (Postmark,
SES, Mailgun, your provider):

```bash
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_SECURE=false          # true with port 465
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Acme <no-reply@acme.com>"
```

Set SPF and DKIM for the sender domain at your provider, or reset mails land in spam. Every mail
also prints the raw token so a user can paste it into the desktop app when the link does not
open. Mails triggered by a request are fire-and-forget: a failing relay is logged as a warning and never fails or slows the request.

## Billing with Stripe

Billing is optional (`BILLING_PROVIDER=none` offers no checkout).

1. In Stripe create two recurring monthly prices: **Pro** (flat) and **Team** (per seat, the
   API sends the number of members as the quantity). Copy their price ids into `STRIPE_PRICE_PRO`
   and `STRIPE_PRICE_TEAM`.
2. Developers, Webhooks, add an endpoint at `https://<API origin>/api/v1/billing/webhook` and
   subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

3. Set `STRIPE_SECRET_KEY` and `BILLING_PROVIDER=stripe`, restart.
4. Configure the customer portal in Stripe (Settings, Billing, Customer portal) so owners can
   manage cards and cancel. Under "Subscriptions", enable **Customers can switch plans** and add
   both prices (Pro and Team) to the product catalog of the portal, otherwise the owner cannot
   move between plans. Also enable **Customers can update quantities** for the Team price (the
   app keeps the seat count in sync itself, so this is optional for customers but must not be
   blocked for the app's own updates).
5. Events the webhook handles (anything else is acknowledged and ignored):
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.

Seats: the Team checkout quantity is the number of live members (the same number seat sync keeps
sending afterwards). Pending invites are not billed until accepted, but they do count against the
plan's seat limit so the limit cannot be outrun. Deleting a workspace cancels its live
subscription first; if Stripe refuses, the delete is refused with 409 `billing.CANCEL_FAILED` and
nothing is removed. Usage in the billing summary sums the cost of every ended run that reports
one (cancelled and expired runs included); `runs` counts finished runs only (completed and
failed).

The webhook is public (verified by signature), not rate limited, and idempotent by Stripe event
id. A canceled subscription moves the workspace back to `free`; limits never delete existing data.
Test the flow with Stripe test keys and `stripe listen --forward-to localhost:3000/api/v1/billing/webhook`.

## Backups

All state is in PostgreSQL (the `be_storage` volume holds nothing you cannot rebuild). Back up
the database daily and keep copies off the host.

```bash
# Dump (custom format, compressed)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${DB_USERNAME:-postgres}" -d "${DB_NAME:-app}" -Fc > backup-$(date +%F).dump

# Restore into an empty database (stop the API first so nothing writes during the restore)
docker compose -f docker-compose.prod.yml stop be
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "${DB_USERNAME:-postgres}" -d "${DB_NAME:-app}" --clean --if-exists --no-owner < backup-2026-01-01.dump
docker compose -f docker-compose.prod.yml start be
```

Practise a restore on a scratch database before you need it. Managed Postgres (RDS, Cloud SQL)
with point-in-time recovery works too: set `DB_HOST` and friends and drop the `postgres` service.
Mind `JWT_ACCESS_SECRET` and `STRIPE_*` too: they are not in the dump.

## Logs and health

- Logs are one JSON object per line on stdout (`LOG_LEVEL`). Every request has an id: the API
  echoes `x-request-id` (or generates one) and error responses carry it as `meta.requestId`, so a
  user can quote it. Authorization headers, cookies, passwords and tokens are redacted. Health
  probes are not logged.
- `GET /api/v1/health` is liveness (process up, used by the image `HEALTHCHECK`).
  `GET /api/v1/health/ready` runs `SELECT 1` and answers 503 when the database is unreachable:
  point load balancer readiness at it.

## Retention

A daily job (03:00) deletes: refresh tokens expired more than 7 days ago, used or expired account
tokens older than 7 days, expired pairing codes, invites expired or revoked more than 30 days ago,
audit events older than `AUDIT_RETENTION_DAYS`, and processed Stripe events older than 90 days. It
logs the number of rows removed per table. `RETENTION_ENABLED=false` turns it off. The job runs on every replica; it is idempotent, so
running it more than once is harmless.

## Limits to know about

- **Single instance.** The realtime stream (`GET /events`), the per-workspace command lock's
  in-process queue, timers, the rate limiter and the retention cron all live in the API process.
  Run exactly one `be` replica. Scaling out needs a shared event bus (e.g. Postgres
  LISTEN/NOTIFY or Redis) and a shared throttler store first.
- One workspace per account: an email belongs to one member of one workspace.
- Desktop clients keep their SSE connection open: put no proxy timeout under a few minutes in
  front of `/api/v1/events` and disable response buffering (`proxy_buffering off` in nginx).

## Upgrades

1. Back up the database.
2. Pull or build the new image and `docker compose -f docker-compose.prod.yml up -d`.
3. The entrypoint runs pending migrations before the API starts; check the logs for
   `[entrypoint] Running database migrations...` and a healthy `/health/ready`.

Migrations are forward-only in production. Roll back by restoring the backup and the previous
image.

The `RoomTimelines` migration (room timelines and reply threads) rewrites the `messages` table
(new columns, backfill, dropped columns and indexes) in one transaction under an exclusive lock, so
chat is unavailable while it runs. On a large data set (hundreds of thousands of messages or more)
plan a maintenance window: stop the API, take the backup, start the new image and wait for the
migration to finish before sending traffic.

## Desktop app

The installer is built for one API URL, and its CSP only allows that origin:

```bash
echo 'VITE_API_URL=https://api.example.com/api/v1' > apps/fe/.env.production
pnpm --filter fe tauri:build
```

Details and per-OS output folders are in the README. The API's `CORS_ORIGINS` must include
`tauri://localhost` and `http://tauri.localhost` (the compose default does).

## Where `APP_URL` points

`APP_URL` is the base of every link in mails and of the Stripe return URLs (`/#/settings/billing`,
`/#/reset-password`, `/#/verify-email`, `/#/invite`). Those links open in a browser, so `APP_URL`
must serve either:

- the web build of the app: `VITE_API_URL=https://api.example.com/api/v1 pnpm --filter fe build`,
  then publish `apps/fe/dist` on any static host. Add that origin to the API's `CORS_ORIGINS` and
  to nothing else (the build bakes the API URL in), or
- a landing page that explains how to open the desktop app.

Desktop flow: a mail link opens the browser, which is fine for password reset and e-mail
verification on the web build. Every mail also carries a pasteable code, so a user who only has
the desktop app copies the code into it. Stripe checkout and the portal return to the browser; the
desktop app refetches the billing summary when its window regains focus, so the new plan shows up
as soon as the user switches back.

## Connecting computers

Owners and admins create a pairing code in the app (Computers page), then run the CLI on the
machine that has Claude Code: `pnpm agent connect --server https://api.example.com --code ABCD-EFGH --start`
(see `packages/cli/README.md`). Plan limits cap the number of computers, agents and seats.
