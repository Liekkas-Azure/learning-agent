# Changelog

## [0.4.1] — 2026-05

### Added
- **语料进入**：Chrome MV3 剪藏扩展（可选 Bearer）、MCP `save_clip`、桌面 `watch-scan.sh` + 定时监视 cron
- **闪卡质量**：文生图失败 emoji 降级、批量重生成 API/UI
- **推荐流**：丰富 `feed_explain`、冷启动主题多样性加分
- **间隔重复**：复习日历 + 掌握度趋势 API，复习页可视化
- **信任透明**：矛盾列表页 `/trust`、闪卡笔记服务端优先
- **可带走**：Obsidian vault zip 导出、定时/手动语料 zip 备份
- **Phase 3**：Hybrid 检索（文库 UI 可切换）、Chat RAG `/chat`、FactChecker + Curator 策展

### Changed
- 推荐流首屏不再阻塞远程文生图探测
- 文库搜索默认 Hybrid 模式，命中原因展示

---

## [0.4.0] — 2026-05

### Added
- 闪卡推荐流（TikTok 式）+ 反馈驱动排序
- 今日主题浏览热度条（Top 4，颜色随热度加深）
- SM-2 间隔重复：`/review`、`/exam`，写回 SRS
- 闪卡答案 Markdown 渲染
- 教学向 AI 配图（类比/场景/对比，非知识结构图）
- 语料全文检索、zip 导出含 SQLite
- C 端落地页 `/welcome` + 服务端等候名单 API
- 六根柱子：质量审计、信任徽章、导出、learning-path
- `RELEASE.md` 发布清单、`scripts/backup_knotory.sh` 备份脚本

### Changed
- API 版本 0.4.0；首页为推荐流，文库深读在 `/library`
- `/health` 增加 `llm_configured` 检查项
- 生产可设 `KNOTORY_DISABLE_OPENAPI=true` 关闭文档暴露

### Security
- 可选 `KNOTORY_API_KEY` Bearer 鉴权
- 上传 / 重操作内存限流；等候名单 IP 限流

---

## [0.3.x] — 更早

- Phase 1–2：上传、wiki、图谱、伴读、矛盾检测、Neo4j 可选
