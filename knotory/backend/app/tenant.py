"""多租户上下文：当前请求的用户 ID（ContextVar）。"""

from __future__ import annotations

from contextvars import ContextVar

from app.config import settings

# 未开启登录时的单用户占位；历史数据迁移到此 ID
LEGACY_USER_ID = "__default__"
# 全员可见的示例闪卡
SYSTEM_USER_ID = "__system__"

_current_user_id: ContextVar[str | None] = ContextVar("knotory_user_id", default=None)
_current_user_email: ContextVar[str | None] = ContextVar("knotory_user_email", default=None)


def auth_enabled() -> bool:
    return bool(settings.auth_required)


def current_user_id() -> str:
    uid = _current_user_id.get()
    if uid:
        return uid
    return LEGACY_USER_ID


def current_user_email() -> str | None:
    return _current_user_email.get()


def set_tenant(*, user_id: str, email: str | None = None) -> None:
    _current_user_id.set(user_id)
    if email:
        _current_user_email.set(email)


def clear_tenant() -> None:
    _current_user_id.set(None)
    _current_user_email.set(None)


def capture_tenant() -> tuple[str, str | None]:
    """后台线程启动前抓取租户；ContextVar 不会自动传入子线程。"""
    return current_user_id(), current_user_email()


def run_as_tenant(user_id: str, email: str | None, fn, /, *args, **kwargs):
    """在指定租户上下文中执行（用于 threading 任务）。"""
    set_tenant(user_id=user_id, email=email)
    try:
        return fn(*args, **kwargs)
    finally:
        clear_tenant()
