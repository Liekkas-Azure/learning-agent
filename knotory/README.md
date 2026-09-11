# Knotory

Knotory 不是「静态知识库 + 固定推荐」的传统教育 AI，而是一套**个性化学习闭环**：

**诊断 → 规划 → 执行 → 评估 → 重规划**

核心能力：

1. **长期记忆（LLM Wiki）**：语料沉淀为 Wiki；Neo4j 维护知识点与先修关系；Milvus + Hybrid RAG 检索知识、典型错误、用户画像与历史经验；Reflector 进行价值过滤和去重后才写回 Memory。
2. **Student State**：融合 BKT 概率更新、可训练 GRU-DKT 时序模型与 LLM 语义诊断；模型按用户交互序列在线微调并持久化 checkpoint，答题、Feed 行为、停留时长和费曼文本共同更新掌握度与错误模式。
3. **Agent 编排**：LangGraph 协调 Planner / Policy / Executor / Memory / Reflector；Policy 使用知识图谱约束、Contextual Bandit 和原生 LLM Function Calling 选择教学 Action，工具失败后自动换策略重规划。

产品形态：个人语料 → 闪卡推荐流 / SRS / 费曼 / 学习路径，反馈持续写回状态与记忆。

This repository contains a runnable web app (Next.js + FastAPI):

- Next.js web UI（Feed / 文库 / 复习 / 费曼 / 学习路径 / 图谱 / RAG Chat）
- FastAPI backend（入库流水线 + Student State + Hybrid RAG + Learning Agent）
- 完整模式使用 **Neo4j + Milvus**；服务不可用时可退化到 SQLite 图约束与本地向量
- **S3-compatible object storage** as source of truth（可 local 开发）

---

## Project Structure

```text
knotory/
├─ frontend/                 # Next.js C 端 UI
├─ backend/                  # FastAPI
│  ├─ app/
│  │  ├─ agents/learning_graph.py   # Planner-Executor-Memory-Reflector
│  │  ├─ agents/learning_planner.py # LLM 结构化动态规划
│  │  ├─ agents/learning_tools.py   # 可执行教学工具与 payload
│  │  ├─ student_state.py           # BKT/DKT 多源 Student State
│  │  ├─ dkt.py                     # 可训练 GRU-DKT + checkpoint
│  │  ├─ wiki_memory.py             # Reflection 写回 LLM Wiki
│  │  ├─ knowledge_graph.py         # Concept / PREREQUISITE_OF 约束
│  │  ├─ vector_store.py            # Milvus 向量记忆（含 local fallback）
│  │  ├─ hybrid_search.py           # 向量 + 关键词 Hybrid
│  │  └─ contextual_bandit.py       # 教学 Action 选型
│  └─ tests/
├─ DEPLOY.md
└─ extension/ desktop/
```

---

## Milestones

### Phase 1–2（已实现）
- 语料入库：上传 / 剪藏 / 监视目录 → wiki + SQLite
- LLM 摘要、标签、PDF/图片 OCR
- 矛盾检测、Neo4j 可选、关系图 `/graph`
- 沉浸式阅读 + 伴读缓存

### Phase 3（已实现）
- 闪卡推荐流 + 反馈驱动排序
- SM-2 复习 / 专题测验 / 费曼讲解
- **Hybrid search（向量 + 关键词）**
- **Chat + RAG**、FactChecker / Curator
- **BKT/DKT Student State** + **LangGraph 学习闭环**
- **LLM Wiki Memory + Reflection 写回**

### Phase 4（可选增强）
- DKT 离线预训练数据集、更细粒度跨学科先修图谱
- 浏览器扩展剪藏、MCP、Cloud 托管

---

## Data storage

**Production (default)**: `KNOTORY_STORAGE_BACKEND=s3` — corpus and `knotory.db` live in S3-compatible object storage; the server uses a local cache only.

**Self-hosted dev**: set `KNOTORY_STORAGE_BACKEND=local` and `KNOTORY_DATA_DIR=~/knotory-data` with subfolders `raw/`, `wiki/`, `outputs/`.

**Export**: from the library UI or API — flashcards (MD/JSON), notes, Obsidian vault zip, corpus manifest, and full archive zip.

---

## Production deploy

See **[DEPLOY.md](./DEPLOY.md)** for Docker Compose, API Key, CORS, health checks, and the go-live checklist.

**发布前**请对照 **[RELEASE.md](./RELEASE.md)** 逐项勾选。

Quick start:

```bash
cd knotory
cp backend/.env.example backend/.env
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Environment Variables

Backend 会按顺序加载 **`knotory/backend/.env`** 与 **monorepo 根目录 `.env`**（后者覆盖前者），因此可与主站共用根目录里的 `ARK_API_KEY` / `ARK_MODEL`。

Backend（`backend/.env` 与/或 仓库根 `.env`）：

```bash
KNOTORY_DATA_DIR=~/knotory-data
KNOTORY_DB_PATH=~/knotory-data/knotory.db
# 摘要与标签：须配置其一 — 优先 ARK（与豆包识图共用 Key 即可）；否则使用 OpenAI 兼容云：
# ARK_API_KEY=...
# ARK_MODEL=doubao-seed-2-0-pro-260215
# DOUBAO_API_BASE=https://ark.cn-beijing.volces.com/api/v3
KNOTORY_CLOUD_API_KEY=         # 未配置 ARK 时使用；OpenAI 或兼容服务端
KNOTORY_CLOUD_BASE_URL=        # 可选，如 https://api.openai.com/v1
KNOTORY_CLOUD_MODEL=gpt-4o-mini
KNOTORY_LOG_LEVEL=INFO
# 完整 Agent 基础设施
KNOTORY_NEO4J_URI=bolt://127.0.0.1:7687
KNOTORY_NEO4J_USER=neo4j
KNOTORY_NEO4J_PASSWORD=knotory-local-dev
KNOTORY_VECTOR_BACKEND=milvus
KNOTORY_MILVUS_URI=http://127.0.0.1:19530
KNOTORY_DKT_ENABLED=true
# KNOTORY_OCR_ENABLED=true
# KNOTORY_PDF_OCR_MIN_CHARS=40
# 伴读（沉浸式阅读右侧导读）：并行节数，默认 1（串行，减轻限流/连接问题）；网络慢可调高 LLM 超时（秒）
# 伴读所切分的正文与前端「AI 抽取结果」一致：优先 raw/*.ai.txt，其次 raw/*.txt，最后 wiki/*.md
# KNOTORY_COMPANION_PARALLEL=1
# KNOTORY_COMPANION_LLM_TIMEOUT_SEC=180
# KNOTORY_COMPANION_CRON_ENABLED=true
# KNOTORY_COMPANION_CRON_HOUR=3
# KNOTORY_COMPANION_CRON_MINUTE=15
# KNOTORY_COMPANION_CRON_TZ=Asia/Shanghai
# Production (see DEPLOY.md)
# KNOTORY_API_KEY=
# KNOTORY_CORS_ORIGINS=https://your-frontend.example.com
# KNOTORY_MAX_UPLOAD_BYTES=33554432
# KNOTORY_UPLOAD_RATE_LIMIT_PER_MIN=12
# KNOTORY_TRUSTED_HOSTS=
# 豆包多模态识图（与 monorepo 一致，任选其一配置 Key）
# ARK_API_KEY=
# ARK_MODEL=doubao-seed-2-0-pro-260215   # 或你在方舟控制台创建的「多模态」推理接入点 ID
# DOUBAO_API_BASE=https://ark.cn-beijing.volces.com/api/v3
# 亦可使用 KNOTORY_ARK_API_KEY / KNOTORY_ARK_VISION_MODEL 仅作用于本服务
```

上传接口在未配置任何文本模型 Key 时将返回 **503**。

Frontend (`frontend/.env.local`):

```bash
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
# NEXT_PUBLIC_KNOTORY_API_KEY=   # 与后端 KNOTORY_API_KEY 一致（公网部署）
```

Copy from `frontend/.env.example` if needed.

---

## Run Phase 1

### 1) Start backend

```bash
cd knotory/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) Start frontend

```bash
cd knotory/frontend
npm install
npm run dev
```

Open: **`http://localhost:3010`**（图谱：`/graph`）。开发环境建议优先用 **`localhost`**，与 `127.0.0.1` 混用可能触发跨源静态资源限制。

若页面 **500** 或报错 `Cannot find module './xxx.js'`，多为 `.next` 缓存损坏，执行：

```bash
cd knotory/frontend && npm run dev:clean
```

### 3) Start Neo4j + Milvus

```bash
cd knotory
docker compose up -d
# 将上面的 KNOTORY_NEO4J_* / KNOTORY_MILVUS_* 写入 backend/.env。
```

---

## Notes on Privacy

- Local-first file storage by default.
- 标签与摘要均由配置的 LLM 从正文生成。
- Summary and tags are produced **only** via a configured LLM API (Volcengine Ark preferred, or OpenAI-compatible `KNOTORY_CLOUD_*`).
- Backend proxies file operations; browser never writes local files directly.

