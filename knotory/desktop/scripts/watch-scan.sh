#!/usr/bin/env bash
# 桌面监视目录辅助：调用 Knotory watch/scan API
set -euo pipefail
API="${KNOTORY_API_BASE:-http://127.0.0.1:8000}"
curl -s -X POST "$API/api/v1/watch/scan" | python3 -m json.tool
