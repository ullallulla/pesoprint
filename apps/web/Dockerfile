# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t pesoprint-web .
#   docker run -p 3000:3000 -e API_URL=http://api:3001 pesoprint-web

ARG VP_IMAGE=ghcr.io/voidzero-dev/vite-plus:1.5.1

# --- build: install the workspace and build the web app ---
FROM ${VP_IMAGE} AS build
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version vite.config.ts tsconfig.json ./
# Copy every workspace manifest so the install matches the lockfile exactly.
COPY --chown=vp:vp apps/api/package.json apps/api/
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp packages/shared/package.json packages/shared/
RUN vp install --frozen-lockfile --ignore-scripts
COPY --chown=vp:vp apps/web apps/web
COPY --chown=vp:vp packages/shared packages/shared
RUN vp run --filter @app/web build
RUN cp "$(vp env which node | head -1)" /tmp/node

# --- deps: production dependencies only ---
FROM ${VP_IMAGE} AS deps
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version vite.config.ts tsconfig.json ./
# All workspace manifests again, so the frozen lockfile matches; --filter still installs only the web app's deps.
COPY --chown=vp:vp apps/api/package.json apps/api/
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp packages/shared/package.json packages/shared/
RUN vp install --frozen-lockfile --ignore-scripts --prod --filter "@app/web"

# --- runtime ---
FROM debian:trixie-slim AS runtime
ENV NODE_ENV=production PORT=3000
# The official Node.js binary links against libatomic, which slim Debian doesn't include.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /tmp/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/build ./apps/web/build
WORKDIR /app/apps/web
USER nobody
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["node", "-e", "fetch('http://localhost:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
