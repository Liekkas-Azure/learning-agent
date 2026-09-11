"""测试默认关闭伴读定时调度，避免 APScheduler 线程干扰单测。"""

import os

# 强制本地存储，避免单测启动时连接用户 .env 中的 S3 桶而长时间阻塞
os.environ["KNOTORY_COMPANION_CRON_ENABLED"] = "false"
os.environ["KNOTORY_STORAGE_BACKEND"] = "local"
