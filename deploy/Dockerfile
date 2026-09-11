# Learning SaaS monorepo — 多阶段构建（参考 knotory/frontend/Dockerfile）
# app-runner 参数：APP_DIR=apps/web|apps/hk|apps/vault，APP_PORT=3040|3030|3020

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/hk/package.json ./apps/hk/
COPY apps/vault/package.json ./apps/vault/
COPY packages/db/package.json ./packages/db/
COPY services/worker/package.json ./services/worker/
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run db:generate --workspace=@learning-saas/db \
  && npm run build --workspace=web \
  && npm run build --workspace=hk \
  && npm run build --workspace=vault \
  && npm run build --workspace=@learning-saas/worker

FROM node:20-alpine AS db-init
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/db ./packages/db
ENV DATABASE_URL=file:/data/learning.db
CMD ["sh", "-c", "npx prisma db push --schema=packages/db/prisma/schema.prisma && npm run seed --workspace=@learning-saas/db"]

FROM node:20-alpine AS app-runner
WORKDIR /app
ENV NODE_ENV=production
ARG APP_DIR=apps/web
ARG APP_PORT=3040
ENV PORT=${APP_PORT}
ENV HOSTNAME=0.0.0.0
RUN addgroup -S learning && adduser -S learning -G learning
COPY --from=builder --chown=learning:learning /app/${APP_DIR}/.next/standalone ./
COPY --from=builder --chown=learning:learning /app/${APP_DIR}/.next/static ./.next/static
COPY --from=builder --chown=learning:learning /app/${APP_DIR}/public ./public
USER learning
EXPOSE ${APP_PORT}
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM node:20-alpine AS worker-runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S learning && adduser -S learning -G learning
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/services/worker/dist ./services/worker/dist
COPY --from=builder /app/services/worker/package.json ./services/worker/package.json
USER learning
WORKDIR /app/services/worker
CMD ["node", "dist/index.js"]
