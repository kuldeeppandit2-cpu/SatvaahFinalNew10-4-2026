# SatvAAh payment service Dockerfile
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
COPY services/payment/package.json      ./services/payment/
COPY services/payment/tsconfig.json     ./services/payment/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/ ./packages/
COPY services/payment/ ./services/payment/

RUN pnpm --filter @satvaaah/types      build
RUN pnpm --filter @satvaaah/errors     build
RUN pnpm --filter @satvaaah/logger     build
RUN pnpm --filter @satvaaah/middleware build
RUN pnpm --filter @satvaaah/db         build
RUN cd packages/db && npx prisma generate
RUN pnpm --filter @satvaaah/config     build
RUN pnpm --filter @satvaaah/payment     build

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules                    ./node_modules
COPY --from=builder /app/packages/types/dist             ./packages/types/dist
COPY --from=builder /app/packages/types/package.json     ./packages/types/
COPY --from=builder /app/packages/errors/dist            ./packages/errors/dist
COPY --from=builder /app/packages/errors/package.json    ./packages/errors/
COPY --from=builder /app/packages/logger/dist            ./packages/logger/dist
COPY --from=builder /app/packages/logger/package.json    ./packages/logger/
COPY --from=builder /app/packages/middleware/dist        ./packages/middleware/dist
COPY --from=builder /app/packages/middleware/package.json ./packages/middleware/
COPY --from=builder /app/packages/db/dist                ./packages/db/dist
COPY --from=builder /app/packages/db/package.json        ./packages/db/
COPY --from=builder /app/packages/db/prisma              ./packages/db/prisma
COPY --from=builder /app/packages/config/dist            ./packages/config/dist
COPY --from=builder /app/packages/config/package.json    ./packages/config/
COPY --from=builder /app/node_modules/.prisma            ./node_modules/.prisma
COPY --from=builder /app/services/payment/dist            ./services/payment/dist
COPY --from=builder /app/services/payment/package.json    ./services/payment/

RUN addgroup -S satvaaah && adduser -S satvaaah -G satvaaah
USER satvaaah
EXPOSE ${PORT:-3000}
CMD ["node", "services/payment/dist/app.js"]
