"""公网部署：可选 API Key、上传限流、请求体大小校验。"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings

logger = logging.getLogger("knotory.security")

# 无需鉴权的路径前缀（健康检查与 OpenAPI 文档）
_PUBLIC_PREFIXES = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)

_AUTH_PUBLIC_PREFIXES = (
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/waitlist",
)

def llm_configured() -> bool:
    return bool(settings.resolved_ark_api_key or settings.resolved_cloud_api_key)


_upload_window: dict[str, list[float]] = defaultdict(list)
_upload_lock = Lock()


def api_key_configured() -> bool:
    return bool((settings.api_key or "").strip())


def verify_bearer_token(authorization: str | None) -> None:
    if not api_key_configured():
        return
    expected = (settings.api_key or "").strip()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="需要 Authorization: Bearer <KNOTORY_API_KEY>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[7:].strip()
    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key 无效",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _path_is_public(path: str) -> bool:
    if any(path == p or path.startswith(p + "/") for p in _PUBLIC_PREFIXES):
        return True
    if any(path == p or path.startswith(p + "/") for p in _AUTH_PUBLIC_PREFIXES):
        return True
    return False


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not api_key_configured() or _path_is_public(request.url.path):
            return await call_next(request)
        try:
            verify_bearer_token(request.headers.get("Authorization"))
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        return await call_next(request)


def check_expensive_rate_limit(client_key: str, *, limit_per_minute: int | None = None) -> None:
    """伴读刷新、闪卡全量同步等重操作限流（与上传共用桶）。"""
    lim = limit_per_minute or max(2, int(settings.upload_rate_limit_per_minute) // 2)
    now = time.time()
    window_start = now - 60.0
    bucket_key = f"expensive:{client_key}"
    with _upload_lock:
        bucket = _upload_window[bucket_key]
        _upload_window[bucket_key] = [t for t in bucket if t >= window_start]
        if len(_upload_window[bucket_key]) >= lim:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"操作过于频繁，请稍后再试（每分钟最多 {lim} 次）",
            )
        _upload_window[bucket_key].append(now)


def check_waitlist_rate_limit(client_key: str) -> None:
    """等候名单按 IP 限流，减轻刷邮箱风险。"""
    limit = max(1, int(settings.waitlist_rate_limit_per_minute))
    now = time.time()
    window_start = now - 60.0
    bucket_key = f"waitlist:{client_key}"
    with _upload_lock:
        bucket = _upload_window[bucket_key]
        _upload_window[bucket_key] = [t for t in bucket if t >= window_start]
        if len(_upload_window[bucket_key]) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"提交过于频繁，请稍后再试（每分钟最多 {limit} 次）",
            )
        _upload_window[bucket_key].append(now)


def check_upload_rate_limit(client_key: str) -> None:
    """按客户端标识（IP）限制上传频率，减轻 LLM 成本被刷风险。"""
    limit = max(1, int(settings.upload_rate_limit_per_minute))
    now = time.time()
    window_start = now - 60.0
    with _upload_lock:
        bucket = _upload_window[client_key]
        _upload_window[client_key] = [t for t in bucket if t >= window_start]
        if len(_upload_window[client_key]) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"上传过于频繁，请稍后再试（每分钟最多 {limit} 次）",
            )
        _upload_window[client_key].append(now)


def client_key_from_request(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def read_upload_with_limit(file) -> bytes:
    """读取上传文件并校验大小上限。"""
    max_bytes = settings.max_upload_bytes
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"文件超过大小上限（{max_bytes // (1024 * 1024)} MB）",
            )
        chunks.append(chunk)
    return b"".join(chunks)


class TenantAuthMiddleware(BaseHTTPMiddleware):
    """解析用户 JWT，设置多租户上下文。"""

    async def dispatch(self, request: Request, call_next):
        from app.auth import get_current_user  # noqa: PLC0415
        from app.tenant import auth_enabled, clear_tenant  # noqa: PLC0415

        if _path_is_public(request.url.path):
            return await call_next(request)
        try:
            await get_current_user(request)
        except HTTPException as exc:
            if auth_enabled():
                return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        try:
            return await call_next(request)
        finally:
            clear_tenant()
