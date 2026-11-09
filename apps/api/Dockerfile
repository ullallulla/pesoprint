# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t pesoprint-api .
# Run migrations, then the server:
#   docker run --rm -e DATABASE_URL=... pesoprint-api node dist/migrate.mjs
#   docker run -p 3001:3001 -e DATABASE_URL=... pesoprint-api

ARG VP_IMAGE=ghcr.io/voidzero-dev/vite-plus:1.5.1

# --- build: install the workspace and bundle the API ---
FROM ${VP_IMAGE} AS build
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version vite.config.ts tsconfig.json ./
# Copy every workspace manifest so the install matches the lockfile exactly.
COPY --chown=vp:vp apps/api/package.json apps/api/
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp packages/shared/package.json packages/shared/
RUN vp install --frozen-lockfile --ignore-scripts
COPY --chown=vp:vp apps/api apps/api
COPY --chown=vp:vp packages/shared packages/shared
RUN vp -C apps/api pack
# The exact Node.js version from .node-version, for the runtime stage.
RUN cp "$(vp env which node | head -1)" /tmp/node

# --- deps: production dependencies only (no vite-plus toolchain) ---
FROM ${VP_IMAGE} AS deps
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version vite.config.ts tsconfig.json ./
# All workspace manifests again, so the frozen lockfile matches; --filter still installs only the API's deps.
COPY --chown=vp:vp apps/api/package.json apps/api/
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp packages/shared/package.json packages/shared/
RUN vp install --frozen-lockfile --ignore-scripts --prod --filter "@app/api"

# --- runtime: slim Debian + Node.js + the bundle ---
FROM debian:trixie-slim AS runtime
ENV NODE_ENV=production PORT=3001
# The official Node.js binary links against libatomic, which slim Debian doesn't include.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /tmp/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
USER nobody
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["node", "-e", "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.mjs"]
