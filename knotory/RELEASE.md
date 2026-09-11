# Knotory 正式发布清单

面向 **v0.4 自托管 MVP** 的发布前检查。按优先级排列；带 `[x]` 为已完成，`[ ]` 为待办。

---

## 发布判定

| 场景 | 是否可发布 | 条件 |
|------|------------|------|
| 个人 / 内网自托管 | ✅ 可以 | 完成下方 **P0** + 配置 LLM |
| 公网单用户实例 | ⚠️ 需加固 | **P0 + P1** 全部完成 |
| Cloud 多租户 SaaS | ❌ 不在 v0.4 范围 | 需账号隔离、计费、BFF |

---

## P0 — 上线阻塞项

- [ ] **LLM 已配置**：`ARK_API_KEY` 或 `KNOTORY_CLOUD_*`；`/health` 中 `llm_configured: true`
- [ ] **数据持久化**：`KNOTORY_DATA_DIR` 挂载卷；确认 `wiki/`、`raw/`、`knotory.db` 在卷内
- [ ] **公网 API 鉴权**：`KNOTORY_API_KEY` + 前端 `NEXT_PUBLIC_KNOTORY_API_KEY`
- [ ] **CORS 收紧**：`KNOTORY_CORS_ORIGINS` 设为前端域名，不用 `*`
- [ ] **TLS 反向代理**：Nginx/Caddy 终止 HTTPS，限制请求体大小
- [ ] **备份策略**：cron 调用 `scripts/backup_knotory.sh` 或卷快照（见 [DEPLOY.md](./DEPLOY.md)）
- [ ] **多副本伴读**：仅一台 `KNOTORY_COMPANION_CRON_ENABLED=true`

## P1 — 强烈建议（本次迭代已部分落地）

- [x] **健康检查增强**：`/health` 含 `llm_configured`、`version`
- [x] **生产关闭 OpenAPI**：`KNOTORY_DISABLE_OPENAPI=true`
- [x] **等候名单限流**：按 IP 每分钟上限，防刷
- [x] **发布文档**：`CHANGELOG.md`、`DEPLOY.md` 版本同步
- [x] **后端 .gitignore**：避免误提交 `.venv` / `.env`
- [x] **集成测试**：SRS 复习 API、429 限流
- [ ] **OpenAPI 鉴权替代方案**：若需保留文档，改为 VPN 内访问
- [ ] **Waitlist 隐私说明**：落地页补充数据用途与保留策略
- [ ] **自动化备份验证**：定期恢复演练（解压 zip + 打开 DB）
- [ ] **前端 E2E 冒烟**：上传 → sync → feed 一条 Playwright

## P2 — 产品完整度（六根柱子）

| 柱子 | 状态 | 剩余 |
|------|------|------|
| 语料进入 | ✅ 高 | 扩展剪藏 / MCP / Electron 为 Phase 4 |
| 闪卡质量 | ✅ 高 | 文生图依赖外部 API；劣质卡标记已有 |
| 推荐流 | ✅ 高 | 今日主题热度条已上线 |
| 间隔重复 | ✅ 中高 | `/review`、`/exam` + SM-2 写回 |
| 信任透明 | ⚠️ 中 | 笔记 Feed 双写 localStorage，可统一为服务端优先 |
| 可带走 | ✅ 高 | zip / manifest / 导出 API |

## P3 — 规划项（非 v0.4 阻塞）

- [ ] Hybrid search（向量 + 关键词）
- [ ] Chat + RAG、Multi-agent（FactChecker / Curator）
- [ ] Cloud 版、支付、Resend 邮件列表
- [ ] PWA / 离线
- [ ] Prometheus 指标、结构化日志、告警 runbook
- [ ] Alembic 式 DB 迁移（当前为 `create_all` + 手写 ALTER）
- [ ] Redis 分布式限流（当前进程内存桶）

---

## 发布步骤（建议顺序）

1. 本地：`cd knotory/backend && pytest -q`；`cd ../frontend && npm run build`
2. 配置 `backend/.env`（LLM、API Key、CORS、DISABLE_OPENAPI）
3. 构建：`docker compose -f docker-compose.prod.yml up -d --build`
4. 验证：`curl /health` → `ok: true`，上传小文件 → 非 503
5. 功能冒烟：文库上传 → 闪卡 sync → 首页 feed → 复习 → 导出 zip
6. 配置备份 cron，写入运维日历
7. 打 tag `v0.4.0`，更新 [CHANGELOG.md](./CHANGELOG.md)

---

## 相关文档

- [README.md](./README.md) — 功能与本地开发
- [DEPLOY.md](./DEPLOY.md) — Docker 与生产配置
- [GTM-C端.md](./GTM-C端.md) — 落地页与增长策略
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
