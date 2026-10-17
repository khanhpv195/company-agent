# syntax=docker/dockerfile:1.7
# Build context must be the monorepo root:
#   docker build -f apps/be/Dockerfile -t be .

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.21.0
ARG TURBO_VERSION=2.11.8

# ---------- base: node + pnpm ----------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN apk add --no-cache libc6-compat \
 && npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---------- prune: keep only `be` and the workspace packages it depends on ----------
FROM base AS pruner
ARG TURBO_VERSION
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune be --docker

# ---------- deps: install from the pruned manifests (cached unless a package.json/lockfile changes) ----------
FROM base AS deps
COPY --from=pruner /app/out/json/ .
# turbo prune drops pnpm settings (allowBuilds), restore the original workspace file.
COPY pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- dev: used by docker-compose.yml (source is bind-mounted) ----------
FROM deps AS dev
COPY --from=pruner /app/out/full/ .
COPY pnpm-workspace.yaml ./
RUN pnpm --filter @repo/shared build
WORKDIR /app/apps/be
ENV NODE_ENV=development
EXPOSE 3000 9229
CMD ["sh", "-c", "pnpm --filter @repo/shared build && sh scripts/migrate.sh run && if [ \"${RUN_SEED:-false}\" = \"true\" ]; then sh scripts/seed.sh; fi && pnpm exec nest start --watch --debug 0.0.0.0:9229"]

# ---------- build: compile and produce a production-only node_modules ----------
FROM deps AS build
COPY --from=pruner /app/out/full/ .
COPY pnpm-workspace.yaml ./
RUN pnpm turbo run build --filter=be...
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter be deploy --prod --legacy /prod/be

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /prod/be/package.json ./package.json
COPY --from=build --chown=node:node /prod/be/node_modules ./node_modules
# `pnpm deploy --legacy` links the workspace package `@repo/shared` to /app/packages/shared:
# ship its manifest and built output there so the link resolves at runtime.
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/be/dist ./dist
COPY --from=build --chown=node:node /app/apps/be/public ./public
COPY --from=build --chown=node:node /app/apps/be/scripts ./scripts
RUN mkdir -p storage/uploads storage/logs && chown -R node:node storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "sh", "scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
