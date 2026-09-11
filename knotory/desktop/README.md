# Knotory Desktop / Watch

本地监视与桌面打包相关脚本。

## 文件夹监视（语料自动入库）

1. 在 `backend/.env` 中启用：
   ```env
   KNOTORY_WATCH_CRON_ENABLED=true
   KNOTORY_WATCH_CRON_HOUR=5
   KNOTORY_WATCH_CRON_MINUTE=30
   ```
2. 或手动扫描一次：
   ```bash
   ./scripts/watch-scan.sh
   ```
3. 默认监视目录：`~/knotory-data/watch/`（将 PDF / Markdown 放入即可）

脚本会调用后端 ingest API，将新文件解析并写入 wiki + 闪卡队列。

## Chrome 剪藏扩展

见 `../extension/`：加载 unpacked 扩展后，在 popup 填写 API 地址；若后端启用了 `KNOTORY_API_KEY`，需填写相同 Bearer token。

## MCP 工具

后端 `app/mcp/server.py` 提供 `save_clip` 等工具，供 Cursor / Claude Desktop 等 MCP 客户端调用。

## Electron 打包（Phase 4）

本目录后续将承载 Electron 壳：内嵌后端进程、原生文件系统集成。
