# Learning Agent

传统教育 AI 多依赖**静态知识库**和**固定推荐策略**，缺乏长期记忆、动态状态判断与自主规划能力。

本项目从 0 到 1 构建个性化学习 Agent，核心目标是通过**长期记忆、状态估计与 Agent 决策**，实现：

**诊断 → 规划 → 执行 → 评估 → 重规划**

---

## 问题与方案

| 难点 | 方案 |
| --- | --- |
| **a. 长期记忆难管理**：需同时维护知识库、用户状态与历史交互，避免无效信息污染 Memory | **LLM Wiki 长期记忆**：Neo4j + Milvus + RAG 沉淀知识点、先修关系、典型错误、用户画像与历史经验；Reflection 筛选高价值信息写回 Memory |
| **b. 学习状态动态变化**：需结合答题、行为、文本等多源信号实时判断掌握度，并动态调整路径 | **BKT / GRU-DKT + LLM 语义诊断** 构建实时 Student State，驱动 Planner 生成路径 |
| **c. Agent 决策链路复杂**：需协调 Planner、Policy、Tool、Reflection，保证可执行且支持失败后重规划 | **LangGraph** 编排 Planner–Executor–Memory–Reflector；图谱约束 + Contextual Bandit + Function Calling 选择教学 Action，执行反馈触发 Re-planning |

---

## 总体架构

```text
                    ┌─────────────────────────────────────┐
                    │           Learning Agent            │
                    │         (LangGraph Loop)            │
                    └─────────────────────────────────────┘
                                      │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
   Diagnose        Plan          Policy         Execute        Evaluate
   Student State   LLM Planner   Bandit /       Teaching       Score +
   + Memory +      + Graph       Function       Tools          Issues
   Graph blockers  constraints   Calling
        │              │              │              │              │
        └──────────────┴──────────────┴──────────────┴──────┬───────┘
                                                            │
                                              needs_replan? │
                                           ┌────────────────┴────────────────┐
                                           ▼                                 ▼
                                        Replan                            Memory
                                   (re-diagnose +                   Reflector 写回
                                    re-plan + policy)               Wiki / Vector
```

闭环语义：

1. **Diagnose**：融合 BKT/DKT、SRS 到期、弱概念、先修 blockers、用户画像、历史 episode
2. **Plan**：启发式路径 + LLM Planner，输出可执行日程与任务
3. **Policy**：在图谱约束候选集上，用 Bandit / LLM Function Calling 选 Action
4. **Execute**：调用白名单教学工具（SRS / 费曼 / 深读 / 测验 / RAG / Feed），返回真实 payload + CTA
5. **Evaluate**：检查工具成败与计划合理性；失败且可重试则进入 Replan
6. **Memory**：Reflector 估值、去重后写回 MemoryEpisode / Wiki / 向量索引

---

## 模块一：LLM Wiki 长期记忆

**路径**：`knotory/backend/app/wiki_memory.py` · `vector_store.py` · `knowledge_graph.py` · `hybrid_search.py`

```text
交互事件 ──► Reflector(价值阈值 + 去重)
                 │
                 ├─ 低价值 → 丢弃（防污染）
                 └─ 高价值 → MemoryEpisode
                              ├─ Wiki：`_student_memory.md`
                              └─ Vector：Milvus（可回退本地）
```

沉淀内容：

- 知识点与先修关系（Neo4j `Concept` / `PREREQUISITE_OF`，SQLite 兜底多跳 blockers）
- 典型错误模式、用户画像、历史经验 episode
- Hybrid RAG：向量 + 关键词，并注入 Student State / Memory 上下文

---

## 模块二：实时 Student State

**路径**：`knotory/backend/app/student_state.py` · `dkt.py`

| 信号源 | 作用 |
| --- | --- |
| 答题 / SRS 评分 | BKT 概率更新 |
| 交互时序 | 可训练 GRU-DKT（在线微调 + checkpoint） |
| 费曼文本 / 语义分 | LLM 语义诊断与错误模式 |
| Feed 行为 / 停留时长 | 画像偏好与证据权重 |

融合策略：样本少时偏 BKT；时序积累后提高 DKT 权重。状态同步写入向量与 `_student_state.md`，供 Planner / Policy / RAG 消费。

---

## 模块三：LangGraph Agent 决策

**路径**：`knotory/backend/app/agents/`

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| Graph | `learning_graph.py` | Diagnose → Plan → Policy → Execute → Evaluate → (Replan) → Memory |
| Planner | `learning_planner.py` | LLM 结构化路径；失败回退启发式 |
| Policy | `learning_policy.py` | 图谱约束候选 + Bandit / Function Calling |
| Tools | `learning_tools.py` | `srs_due` / `feynman` / `deep_read` / `exam` / `rag_clarify` / `feed_review` |
| Bandit | `contextual_bandit.py` | Thompson Sampling；执行结果与前端反馈写 reward |

节点命名与状态 key 隔离（如 `plan_node`），保证真实 LangGraph 可编译；不可用时回退同构状态机，并如实上报 `engine`。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| Agent 编排 | LangGraph（StateGraph + 条件边 Replan） |
| 知识图谱 | Neo4j（可选）+ SQLite 先修边 |
| 向量记忆 | Milvus（可选）+ 本地向量 fallback |
| 检索 | Hybrid RAG（向量 + 关键词） |
| 掌握度 | BKT + PyTorch GRU-DKT |
| 策略 | Contextual Bandit + LLM Function Calling |
| 应用 | FastAPI + Next.js（`knotory/`） |

完整模式：`docker compose up -d` 启动 Neo4j / Milvus；未配置时自动降级，闭环仍可运行。

---

## 仓库结构（Agent 相关）

```text
knotory/
├─ backend/app/
│  ├─ agents/
│  │  ├─ learning_graph.py      # LangGraph 闭环
│  │  ├─ learning_planner.py    # LLM Planner
│  │  ├─ learning_policy.py     # Policy / Function Calling
│  │  └─ learning_tools.py      # 可执行教学工具
│  ├─ student_state.py          # BKT + 多源观测 + 画像
│  ├─ dkt.py                    # GRU-DKT 训练 / 推理
│  ├─ wiki_memory.py            # Reflection 写回 Memory
│  ├─ knowledge_graph.py        # 先修拓扑约束
│  ├─ vector_store.py           # Milvus / local
│  ├─ hybrid_search.py          # Hybrid RAG
│  └─ contextual_bandit.py      # Action 选型与奖励
├─ frontend/                    # Feed / 学习路径 / 费曼 / RAG Chat
└─ docker-compose.yml           # Neo4j + Milvus
```

---

## 快速体验 Agent 闭环

```bash
cd knotory/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
cd knotory/frontend
npm install && npm run dev
```

打开 `http://localhost:3010/learning-path`，可查看诊断摘要、Agent trace、当前 Action CTA、评估问题，并对 Bandit 提交反馈。

可选基础设施：

```bash
cd knotory && docker compose up -d
# 配置 KNOTORY_NEO4J_* / KNOTORY_VECTOR_BACKEND=milvus / KNOTORY_MILVUS_URI
```

更细的部署说明见 [`knotory/DEPLOY.md`](knotory/DEPLOY.md)。
