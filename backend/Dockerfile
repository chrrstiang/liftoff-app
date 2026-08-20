# Multi-stage build for the LiftOff NestJS API.
#
# Node 20 to match .nvmrc and the CI matrix. A container on a different major than
# CI is how you get an "it worked locally" failure that only shows up in the cloud.
#
# Build from the backend/ directory:
#   docker build -t liftoff-api ./backend
#
# Run it (never bake .env into the image -- see .dockerignore):
#   docker run --rm -p 8000:8000 --env-file backend/.env liftoff-api

# ---------------------------------------------------------------------------
# Stage 1: build
#
# Needs devDependencies (nest CLI, typescript), so a plain `npm ci` here. None of
# this layer ships.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of source
# changes -- otherwise every edit reinstalls everything.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: runtime
#
# Production dependencies plus dist/. No sources, no devDependencies, no test
# fixtures.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

# The commit this image was built from, surfaced by GET /health.
#
# This is what lets a deploy prove it rolled: it is the one thing that differs
# between the old container and the new one. Declared in the *runtime* stage
# specifically so it does not invalidate the builder's dependency cache -- putting
# it earlier would reinstall node_modules on every commit.
#
# Defaults to "unknown" so a local `docker build` with no --build-arg still works.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package.json package-lock.json ./

# --omit=dev drops the build toolchain. `npm ci` needs the lockfile, which is why
# it is copied rather than reconstructed.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# node:alpine ships a non-root `node` user. Running as root in a container is an
# unnecessary escalation path if the process is ever compromised.
USER node

# src/main.ts already binds HOST || 0.0.0.0, which is required in a container --
# binding 127.0.0.1 would make the port unreachable from outside.
EXPOSE 8000

# Container-level check for local runs and `docker ps` status. ECS uses the ALB
# target group's check instead, but this makes a broken image obvious immediately.
# alpine has no curl, and Node 20 has a global fetch, so shell out to node.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
