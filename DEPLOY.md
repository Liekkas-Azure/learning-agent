# Learning SaaS 生产部署

面向**自托管 VPS / 云主机**，模式与 [knotory/DEPLOY.md](knotory/DEPLOY.md) 一致：`docker compose` + 持久化卷 + 健康检查。

默认对外端口（可在 `.env` 覆盖，避免与已有 3000 主站、Knotory 3010 冲突）：

| 服务 | 环境变量 | 默认端口 | 说明 |
| --- | --- | --- | --- |
| 学习主站 `web` | `LEARNING_WEB_PORT` | **3040** | 主题、采集、洞察入口 |
| 港股看板 `hk` | `LEARNING_HK_PORT` | **3030** | 独立 Next 应用 |
| 知识库 `vault` | `LEARNING_VAULT_PORT` | **3020** | 独立 Next 应用 |
| Redis / Worker | — | 不映射 | 队列与抓取 Worker |

## 上线清单

| 项 | 说明 |
| --- | --- |
| 环境文件 | 复制根目录 `.env.example` → `.env`，填入 `DOUBAO_API_KEY` / `OPENAI_API_KEY` 等可选能力 |
| 公网 URL | 设置 `NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_HK_APP_URL`、`NEXT_PUBLIC_VAULT_APP_URL` 为浏览器可访问地址（含端口或反代域名） |
| 数据库 | Compose 使用 **SQLite 文件** `file:/data/learning.db`（卷 `learning-data`）；首次启动 `db-init` 会 `db push` + `seed` |
| Worker | 依赖 Redis；未配置 `OPENAI_API_KEY` 时跳过嵌入 |
| 反向代理 | 建议 Nginx/Caddy 终止 TLS，按路径或子域转发到 3040 / 3030 / 3020 |
| PWA | 生产环境启用 Service Worker；发版后若遇白屏，清除浏览器 SW 缓存 |

## 一键启动

```bash
cd /path/to/learning-saas
cp .env.example .env
# 编辑 .env：至少设置对外 URL，例如：
# NEXT_PUBLIC_APP_URL=http://YOUR_SERVER_IP:3040
# NEXT_PUBLIC_HK_APP_URL=http://YOUR_SERVER_IP:3030
# NEXT_PUBLIC_VAULT_APP_URL=http://YOUR_SERVER_IP:3020
# LEARNING_WEB_PORT=3040   # 若 3040 仍冲突可改为 3041 等

docker compose -f docker-compose.prod.yml up -d --build
```

访问：

- 主站：<http://127.0.0.1:3040>
- 港股：<http://127.0.0.1:3030>
- 知识库：<http://127.0.0.1:3020>

## 常用命令

```bash
# 查看状态
docker compose -f docker-compose.prod.yml ps

# 跟踪日志
docker compose -f docker-compose.prod.yml logs -f web worker

# 重新构建并滚动更新
docker compose -f docker-compose.prod.yml up -d --build

# 仅重建主站
docker compose -f docker-compose.prod.yml up -d --build web

# 停止
docker compose -f docker-compose.prod.yml down
```

## 仅部署主站 + Worker（省资源）

若不需要独立港股 / 知识库容器，可只启动部分服务：

```bash
docker compose -f docker-compose.prod.yml up -d --build redis db-init web worker
```

## 换端口示例

在 `.env` 中：

```bash
LEARNING_WEB_PORT=3041
LEARNING_HK_PORT=3031
LEARNING_VAULT_PORT=3021
NEXT_PUBLIC_APP_URL=http://203.0.113.10:3041
NEXT_PUBLIC_HK_APP_URL=http://203.0.113.10:3031
NEXT_PUBLIC_VAULT_APP_URL=http://203.0.113.10:3021
```

修改 `LEARNING_*_PORT` 后需重新 `docker compose up -d`；**容器内**仍监听 3040/3030/3020，映射由 Compose `ports` 左侧决定。

## 健康检查

各 Next 服务对 `GET /` 做 HTTP 探活（Dockerfile `HEALTHCHECK`）。Worker 无 HTTP 端口，请用 `docker compose logs worker` 确认已连接 Redis。

## 备份

SQLite 数据位于 Docker 卷 `learning-data`：

```bash
docker compose -f docker-compose.prod.yml run --rm -v learning-data:/data alpine \
  sh -c "cp /data/learning.db /data/learning.db.bak.$(date +%Y%m%d)"
```

或使用 `docker volume inspect learning-saas_learning-data` 定位卷路径后做文件级备份。

## 与 Knotory 同机部署

| 项目 | 建议端口 |
| --- | --- |
| Knotory 前端 | 3010 |
| Learning 主站 | **3040** |
| Learning 知识库 | 3020 |
| Learning 港股 | 3030 |

确保防火墙 / 安全组放行对应 TCP 端口。
