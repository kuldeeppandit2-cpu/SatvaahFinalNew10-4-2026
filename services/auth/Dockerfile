# ============================================================
# SatvAAh auth service Dockerfile
# Base: Node 18 Alpine | Port: 3001
# Build context: monorepo root (required for workspace packages)
# ============================================================

# ---- Stage 1: Base with pnpm ----
FROM node:18-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ---- Stage 2: Install dependencies ----
FROM base AS deps

# Copy workspace manifests (monorepo root + all packages auth depends on)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY packages/types/package.json       ./packages/types/
COPY packages/errors/package.json      ./packages/errors/
COPY packages/logger/package.json      ./packages/logger/
COPY packages/middleware/package.json  ./packages/middleware/
COPY packages/db/package.json          ./packages/db/
COPY packages/config/package.json      ./packages/config/
COPY services/auth/package.json        ./services/auth/
COPY services/auth/tsconfig.json       ./services/auth/

# Use --no-frozen-lockfile until pnpm-lock.yaml is committed
RUN pnpm install --frozen-lockfile

# ---- Stage 3: Build ----
FROM deps AS builder

# Copy source for shared packages
COPY packages/types/      ./packages/types/
COPY packages/errors/     ./packages/errors/
COPY packages/logger/     ./packages/logger/
COPY packages/middleware/  ./packages/middleware/
COPY packages/db/          ./packages/db/
COPY packages/config/      ./packages/config/

# Copy auth service source
COPY services/auth/ ./services/auth/

# Build shared packages in dependency order
RUN pnpm --filter @satvaaah/types      build
RUN pnpm --filter @satvaaah/errors     build
RUN pnpm --filter @satvaaah/logger     build
RUN pnpm --filter @satvaaah/middleware build
RUN pnpm --filter @satvaaah/db         build
# Generate Prisma client AFTER db package build (Critical: client must exist before service build)
RUN cd packages/db && npx prisma generate
RUN pnpm --filter @satvaaah/config     build

# Build auth service
RUN pnpm --filter @satvaaah/auth build

# ---- Stage 4: Production runtime ----
FROM node:18-alpine AS runner
RUN npm install -g pnpm@9
WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/types/dist      ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/errors/dist     ./packages/errors/dist
COPY --from=builder /app/packages/errors/package.json ./packages/errors/
COPY --from=builder /app/packages/logger/dist     ./packages/logger/dist
COPY --from=builder /app/packages/logger/package.json ./packages/logger/
COPY --from=builder /app/packages/middleware/dist  ./packages/middleware/dist
COPY --from=builder /app/packages/middleware/package.json ./packages/middleware/
COPY --from=builder /app/packages/db/dist          ./packages/db/dist
COPY --from=builder /app/packages/db/package.json  ./packages/db/
# Copy Prisma generated client (required at runtime for DB queries)
COPY --from=builder /app/node_modules/.prisma      ./node_modules/.prisma
COPY --from=builder /app/packages/db/prisma        ./packages/db/prisma
COPY --from=builder /app/packages/config/dist      ./packages/config/dist
COPY --from=builder /app/packages/config/package.json ./packages/config/

COPY --from=builder /app/services/auth/dist  ./services/auth/dist
COPY --from=builder /app/services/auth/package.json ./services/auth/

# Run as non-root user
RUN addgroup -S satvaaah && adduser -S satvaaah -G satvaaah
USER satvaaah

EXPOSE 3001

# Env vars are injected by docker-compose.yml (Critical Rule #12)
# Never bake secrets into the image
CMD ["node", "services/auth/dist/app.js"]
