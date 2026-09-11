# Knotory 生产部署

面向**个人 / 小团队自托管**，不是多租户 SaaS。上线前请完成下列检查。

## 上线清单

| 项 | 说明 |
| --- | --- |
| LLM | 配置 `ARK_API_KEY` 或 `KNOTORY_CLOUD_*`，否则上传返回 503 |
| API 鉴权 | 公网务必设置 `KNOTORY_API_KEY`，前端同步 `NEXT_PUBLIC_KNOTORY_API_KEY` |
| CORS | 生产将 `KNOTORY_CORS_ORIGINS` 设为前端站点 URL，勿用 `*` |
| 对象存储 | **默认** `KNOTORY_STORAGE_BACKEND=s3`：语料与 `knotory.db` 存 S3 兼容桶；本地仅作缓存 |
| 数据卷 | `local` 模式持久化 `/data`；`s3` 模式仅需 `/cache` 工作目录（可用 `docker-compose.cloud.yml`） |
| 反向代理 | 建议 Nginx/Caddy 终止 TLS，限制请求体大小 |
| 伴读定时 | 多副本仅一台 `KNOTORY_COMPANION_CRON_ENABLED=true` |
| 备份 | 定期运行 `scripts/backup_knotory.sh` 或卷快照；也可用「打包下载语料库」校验 |

## Docker Compose（推荐）

```bash
cd knotory
cp backend/.env.example backend/.env
# 编辑 backend/.env：ARK_API_KEY、KNOTORY_API_KEY、KNOTORY_CORS_ORIGINS 等

# 公网部署时，构建前端前指定浏览器可访问的 API 地址：
export NEXT_PUBLIC_API_BASE=https://api.your-domain.com
export NEXT_PUBLIC_KNOTORY_API_KEY=与后端相同的密钥

docker compose -f docker-compose.prod.yml up -d --build
```

- 前端：<http://localhost:3010>
- 后端：<http://localhost:8000>，`GET /health` 用于探活

若 API 与 UI 同域（如 `https://knotory.example.com` 与 `https://knotory.example.com/api`），需在反向代理层做路径转发，并将 `NEXT_PUBLIC_API_BASE` 设为该 API 的**完整对外 URL**。

## 环境变量摘要

见 `backend/.env.example`、`frontend/.env.example`。

**安全说明**：`NEXT_PUBLIC_*` 会打进前端 JS，API Key 仅适合个人实例或内网；更高安全需求请在前端同域 BFF 代发请求，或仅 VPN 访问。

## 健康检查

`GET /health` 返回：

```json
{
  "ok": true,
  "checks": {
    "database": true,
    "data_dir_writable": true,
    "llm_configured": true
  },
  "storage": {
    "backend": "s3",
    "bucket": "knotory-corpus",
    "prefix": "knotory",
    "cache_root": "/cache"
  },
  "api_auth_required": true,
  "openapi_enabled": false,
  "version": "0.4.0"
}
```

`ok: false` 时容器编排应标记实例不可用。

## 备份

```bash
chmod +x knotory/scripts/backup_knotory.sh
# 默认备份 ~/knotory-data → ~/knotory-backups/knotory-backup-YYYYMMDD-HHMMSS.zip
./knotory/scripts/backup_knotory.sh

# 或指定目录
KNOTORY_DATA_DIR=/data KNOTORY_BACKUP_DIR=/backups ./knotory/scripts/backup_knotory.sh
```

建议 cron 每日执行；恢复时将 zip 解压到 `KNOTORY_DATA_DIR` 并重启服务。

## CI

仓库根目录 `.github/workflows/knotory-ci.yml`：后端 `pytest`、前端 `tsc` + `next build`。

## 公网安全（必读）

新机器上线后常在数小时内遭遇 SSH 暴力破解与端口扫描。部署后请完成：

| 项 | 说明 |
| --- | --- |
| 防火墙 | 仅开放 **22 / 80 / 443**；**勿**将 **8000** 暴露公网（API 只监听 `127.0.0.1`，经 Nginx/Next 反代） |
| fail2ban | SSH 失败 3 次封禁 24h |
| SSH | 建议改用 **密钥登录** 并关闭 root 密码；至少修改强密码 |
| 阿里云 | 安全组只放行 22/80/443；开启「云安全中心」；可选 WAF |
| JWT | 疑似入侵后轮换 `KNOTORY_JWT_SECRET`（全员需重新登录） |
| Docker | 未使用时 `systemctl disable docker`，减少攻击面 |

后端 systemd 应使用 `--host 127.0.0.1 --port 8000`，勿 `--host 0.0.0.0`。


Knotory 是**单人文库 PKM**（自有材料、Markdown、关系图、原稿/AI 对照），不提供全网剪藏或多租户计费；公网多用户产品需另做账号与隔离。
