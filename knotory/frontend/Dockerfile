FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
ARG NEXT_PUBLIC_KNOTORY_API_KEY=
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_KNOTORY_API_KEY=$NEXT_PUBLIC_KNOTORY_API_KEY
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
RUN addgroup -S knotory && adduser -S knotory -G knotory
USER knotory
COPY --from=builder /app/public ./public
COPY --from=builder --chown=knotory:knotory /app/.next/standalone ./
COPY --from=builder --chown=knotory:knotory /app/.next/static ./.next/static
EXPOSE 3010
CMD ["node", "server.js"]
