# Build context is the repo root — the workspace lockfile lives there.
#   docker build -f service/Dockerfile -t ottopus-service .
#
# Deliberately host-agnostic: a plain container listening on $PORT. It runs the
# same on Railway, Render, Fly or a bare EC2 box, so switching hosts is a
# redeploy and never a rewrite.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY service/package.json ./service/
RUN pnpm install --frozen-lockfile --filter "@ottopus/service..."

COPY service ./service
RUN pnpm --filter @ottopus/service build

# Reinstall production deps from scratch rather than copying node_modules
# across stages — pnpm's symlinked store does not survive a COPY.
FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY service/package.json ./service/
RUN pnpm install --frozen-lockfile --prod --filter "@ottopus/service..." \
 && pnpm store prune

COPY --from=build /app/service/dist ./service/dist

USER node
EXPOSE 8787

# Platforms override PORT; the app reads it and falls back to 8787.
CMD ["node", "service/dist/index.js"]
