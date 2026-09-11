# Learning SaaS（多学科学习）

Monorepo：Next.js PWA 前端 + Prisma/PostgreSQL + Redis/BullMQ 采集 Worker。

## 本地运行

1. 复制环境变量：

   ```bash
   cp .env.example .env
   ```

2. **在本机安装并启动 PostgreSQL**，创建数据库与用户，使连接串与 `.env` 中的 `DATABASE_URL` 一致（示例为 `postgresql://learn:learn@localhost:5432/learning_saas`，需自行建库 `learning_saas` 与用户 `learn` / 密码 `learn`，或改成你本地的账号）。

3. （可选）**在本机安装并启动 Redis**，供采集 Worker 使用；`.env` 中配置 `REDIS_URL`（默认 `redis://127.0.0.1:6379`）。

4. 初始化 schema 与演示组织：

   ```bash
   npm install
   npm run setup:db
   ```

   或分步执行：`npm run db:generate` → `npm run db:push` → `npm run db:seed`。

5. 终端 A：Web

   ```bash
   npm run dev
   ```

6. 终端 B：Worker（消费抓取 / RSS / 嵌入 / 刷新队列；需 Redis）

   ```bash
   npm run worker
   ```

7. 浏览器打开 `http://localhost:3000`（端口以终端为准）：新建主题 → 进入详情 →「**智能采集资料**」（自动发现百度百科、国内主流 RSS，以及可选博查网页结果并入队抓取）。

## 说明

- **智能选源**：默认无需用户粘贴 URL。`POST /api/topics/:id/discover` 会聚合**境内可访问**来源（百度百科、国内 RSS）；可选配置 `BOCHA_API_KEY`（博查 AI）增强中文网页检索。
- **策略**：`strict` 遵守 robots，正文以摘要为主；`expanded` 可存更长正文（仍建议在 PRD 框架内使用）。自动发现的来源默认 `strict`、网页种子 `crawlDepth=0`（单页）。
- **刷新**：来源字段「刷新间隔（分钟）」写入 `Source.refreshCron`；Worker 每 5 分钟扫描并对待刷新来源下发 `REFRESH_SOURCE`（RSS/种子会先 `HEAD` 比对 ETag/Last-Modified）。
- **嵌入**：设置 `OPENAI_API_KEY` 后 Worker 会为分块写入向量（JSON 存库）；无 Key 时跳过嵌入并记审计日志。
- **对象存储**：`.env.example` 中 S3 变量为预留，可按需接入快照上传。

更完整的合规与产品边界见 [docs/PRD.md](docs/PRD.md)。

## 生产部署（Docker）

与 Knotory 同机自托管时，主站默认映射 **3040** 端口（避免占用 3000 / Knotory 3010）。详见 [DEPLOY.md](DEPLOY.md)。

```bash
cp .env.example .env   # 编辑 NEXT_PUBLIC_* 与 API Key
npm run deploy:up      # docker compose -f docker-compose.prod.yml up -d --build
```

访问：主站 `:3040` · 港股 `:3030` · 知识库 `:3020`（端口可在 `.env` 用 `LEARNING_*_PORT` 调整）。

## 目录结构

- `apps/web` — Next.js App Router、API、PWA
- `packages/db` — Prisma schema 与 seed
- `services/worker` — BullMQ 消费者（抓取、RSS、嵌入、刷新）
