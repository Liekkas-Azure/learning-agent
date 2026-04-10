# Learning SaaS（多学科学习）

Monorepo：Next.js PWA 前端 + Prisma/PostgreSQL + Redis/BullMQ 采集 Worker。

## 本地运行

1. 复制环境变量：

   ```bash
   cp .env.example .env
   ```

2. 启动数据库与 Redis（需本机 Docker 可拉镜像）：

   ```bash
   docker compose up -d
   ```

3. 初始化 schema 与演示组织：

   ```bash
   npm install
   npm run db:generate
   npm run db:push
   npm run db:seed
   ```

4. 终端 A：Web

   ```bash
   npm run dev
   ```

5. 终端 B：Worker（消费抓取 / RSS / 嵌入 / 刷新队列）

   ```bash
   npm run worker
   ```

6. 浏览器打开 `http://localhost:3000`：新建主题 → 添加 RSS 或网页种子 →「开始采集」。

## 说明

- **策略**：`strict` 遵守 robots，正文以摘要为主；`expanded` 可存更长正文（仍建议在 PRD 框架内使用）。
- **刷新**：来源字段「刷新间隔（分钟）」写入 `Source.refreshCron`；Worker 每 5 分钟扫描并对待刷新来源下发 `REFRESH_SOURCE`（RSS/种子会先 `HEAD` 比对 ETag/Last-Modified）。
- **嵌入**：设置 `OPENAI_API_KEY` 后 Worker 会为分块写入向量（JSON 存库）；无 Key 时跳过嵌入并记审计日志。
- **对象存储**：`.env.example` 中 S3 变量为预留，可按需接入快照上传。

更完整的合规与产品边界见 [docs/PRD.md](docs/PRD.md)。

## 目录结构

- `apps/web` — Next.js App Router、API、PWA
- `packages/db` — Prisma schema 与 seed
- `services/worker` — BullMQ 消费者（抓取、RSS、嵌入、刷新）
