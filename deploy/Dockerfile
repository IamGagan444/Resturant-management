# syntax=docker/dockerfile:1.7
# One Dockerfile for the whole monorepo; build context is the repo root.
#   target api       Fastify API + background jobs (also runs migrations)
#   target customer  Next.js guest app (next start)
#   target web       Caddy: HTTPS for every host + the static staff console

FROM node:20-bookworm-slim AS base
# openssl: Prisma's query engine. Debian (glibc) so argon2 / sharp / Prisma use their prebuilt binaries.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.34.1 --activate
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── dependencies (cached until a package.json or the lockfile changes) ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/customer/package.json apps/customer/
COPY apps/console/package.json apps/console/
COPY apps/hub/package.json apps/hub/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

# ── API ──
FROM source AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "--import", "tsx", "src/server.ts"]

# ── Guest app ──
FROM source AS customer-build
# Baked in at build time (rewrites + browser socket URL): rebuild if the API address changes.
ARG API_URL
ENV API_URL=${API_URL}
RUN pnpm --filter @rms/customer build

FROM customer-build AS customer
ENV NODE_ENV=production
WORKDIR /app/apps/customer
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]

# ── Staff console (static) + Caddy ──
FROM source AS console-build
ARG API_URL
ENV API_URL=${API_URL}
RUN pnpm --filter @rms/console build

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=console-build /app/apps/console/out /srv/console
