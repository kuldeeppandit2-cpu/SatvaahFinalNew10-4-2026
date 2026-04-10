# SatvAAh search service Dockerfile
# Build context: monorepo root (required for workspace packages)

FROM node:18-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/types/package.json       ./packages/types/
COPY packages/errors/package.json      ./packages/errors/
COPY packages/logger/package.json      ./packages/logger/
COPY packages/middleware/package.json  ./packages/middleware/
COPY packages/db/package.json          ./packages/db/
COPY packages/config/package.json      ./packages/config/
COPY services/search/package.json      ./services/search/
COPY services/search/tsconfig.json     ./services/search/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/ ./packages/
COPY services/search/ ./services/search/

# Build shared packages in dependency order — FAIL HARD if any fail
RUN pnpm --filter @satvaaah/types      build
RUN pnpm --filter @satvaaah/errors     build
RUN pnpm --filter @satvaaah/logger     build
RUN pnpm --filter @satvaaah/middleware build
RUN pnpm --filter @satvaaah/db         build
RUN cd packages/db && npx prisma generate
RUN pnpm --filter @satvaaah/config     build
RUN pnpm --filter @satvaaah/search     build

FROM node:18-alpine AS runner
WORKDIR /app

# Copy only production artefacts — NOT src/, NOT dev deps
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
COPY --from=builder /app/packages/db/prisma        ./packages/db/prisma
COPY --from=builder /app/packages/config/dist      ./packages/config/dist
COPY --from=builder /app/packages/config/package.json ./packages/config/
COPY --from=builder /app/node_modules/.prisma      ./node_modules/.prisma
COPY --from=builder /app/services/search/dist      ./services/search/dist
COPY --from=builder /app/services/search/package.json ./services/search/

RUN addgroup -S satvaaah && adduser -S satvaaah -G satvaaah
USER satvaaah

EXPOSE 3003
CMD ["node", "services/search/dist/app.js"]
