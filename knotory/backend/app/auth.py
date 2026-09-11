"""用户注册 / 登录 / JWT。"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.config import settings
from app.models import User
from app.storage import engine
from app.tenant import LEGACY_USER_ID, auth_enabled, clear_tenant, set_tenant

_PASSWORD_ITERATIONS = 120_000


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return urlsafe_b64decode(s + pad)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), _PASSWORD_ITERATIONS)
    return f"pbkdf2${_PASSWORD_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt, hex_digest = stored.split("$", 3)
        if algo != "pbkdf2":
            return False
        iters = int(iters_s)
        expected = bytes.fromhex(hex_digest)
        got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iters)
        return hmac.compare_digest(got, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(*, user_id: str, email: str) -> str:
    secret = settings.jwt_secret.encode("utf-8")
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    exp = int(time.time()) + settings.jwt_expire_hours * 3600
    payload = _b64url(
        json.dumps({"sub": user_id, "email": email, "exp": exp}, separators=(",", ":")).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    sig = _b64url(hmac.new(secret, signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def decode_access_token(token: str) -> dict:
    secret = settings.jwt_secret.encode("utf-8")
    try:
        header_b64, payload_b64, sig_b64 = token.split(".", 2)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌") from exc
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected_sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    try:
        got_sig = _b64url_decode(sig_b64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌") from exc
    if not hmac.compare_digest(got_sig, expected_sig):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌")
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌") from exc
    exp = int(payload.get("exp") or 0)
    if exp < int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")
    if not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌")
    return payload


def register_user(*, email: str, password: str, display_name: str = "") -> User:
    email_norm = email.strip().lower()
    if not email_norm or "@" not in email_norm:
        raise HTTPException(status_code=400, detail="请输入有效邮箱")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    with Session(engine) as session:
        exists = session.exec(select(User).where(User.email == email_norm)).first()
        if exists:
            raise HTTPException(status_code=409, detail="该邮箱已注册")
        user = User(
            id=str(uuid.uuid4()),
            email=email_norm,
            password_hash=hash_password(password),
            display_name=(display_name or email_norm.split("@")[0])[:64],
            created_at=datetime.utcnow(),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def authenticate_user(*, email: str, password: str) -> User:
    email_norm = email.strip().lower()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == email_norm)).first()
        if user is None or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="邮箱或密码错误")
        return user


def get_user_by_id(user_id: str) -> User | None:
    with Session(engine) as session:
        return session.get(User, user_id)


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def resolve_user_from_request(request: Request) -> User | None:
    token = _extract_bearer(request)
    if not token:
        return None
    # 部署级 API Key 不作为用户身份
    if settings.api_key and token == settings.api_key.strip():
        return None
    if token.count(".") != 2:
        return None
    payload = decode_access_token(token)
    user = get_user_by_id(str(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def get_current_user(request: Request) -> User:
    if not auth_enabled():
        # 单租户模式：虚拟用户
        class _Legacy:
            id = LEGACY_USER_ID
            email = "local@knotory"
            display_name = "本地用户"

        set_tenant(user_id=LEGACY_USER_ID, email="local@knotory")
        return _Legacy()  # type: ignore[return-value]

    user = resolve_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    set_tenant(user_id=user.id, email=user.email)
    return user


async def optional_current_user(request: Request) -> User | None:
    try:
        return await get_current_user(request)
    except HTTPException:
        clear_tenant()
        return None


CurrentUser = Depends(get_current_user)
