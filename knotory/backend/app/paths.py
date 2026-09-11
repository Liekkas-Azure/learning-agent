"""按租户隔离的语料目录。"""

from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.tenant import LEGACY_USER_ID, auth_enabled, current_user_id


def tenant_data_dir(user_id: str | None = None) -> Path:
    """当前用户可写的 raw/wiki/outputs 根目录。"""
    uid = user_id or current_user_id()
    base = settings.resolved_data_dir
    if auth_enabled() or uid not in (LEGACY_USER_ID, ""):
        root = base / "users" / uid
        for sub in ("raw", "wiki", "outputs"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    return base
