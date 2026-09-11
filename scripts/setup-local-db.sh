#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "==> 未找到 .env，从 .env.example 复制"
  cp .env.example .env
  echo "请编辑 .env：将 DATABASE_URL 指向本机已启动的 PostgreSQL（需先创建库与用户，或与示例 URL 一致）。"
fi

echo "==> prisma generate"
npm run db:generate

echo "==> prisma db push（需 PostgreSQL 已运行且 DATABASE_URL 可连接）"
npm run db:push

echo "==> prisma seed"
npm run db:seed

echo "==> 完成。执行 npm run dev 启动 Web；采集 Worker 需本机 Redis（REDIS_URL）并执行 npm run worker。"
