"""统一 Embedding：优先方舟/云端 embedding，否则确定性本地哈希向量。"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import Sequence

from app.config import settings

logger = logging.getLogger("knotory.embeddings")

_DEFAULT_DIM = 384


def embedding_dim() -> int:
    return max(64, int(getattr(settings, "embedding_dim", _DEFAULT_DIM) or _DEFAULT_DIM))


def _tokenize(text: str) -> list[str]:
    text = (text or "").lower()
    # 中英混排：汉字单字 + 英文词
    parts = re.findall(r"[\u4e00-\u9fff]|[a-z0-9_]{2,}", text)
    return parts[:800]


def _hash_embed(text: str, *, dim: int) -> list[float]:
    vec = [0.0] * dim
    tokens = _tokenize(text)
    if not tokens:
        return vec
    for tok in tokens:
        digest = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[idx] += sign
    # L2 normalize
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _api_embed(texts: Sequence[str]) -> list[list[float]] | None:
    model = (getattr(settings, "embedding_model", "") or "").strip()
    if not model:
        return None
    try:
        from openai import OpenAI  # noqa: PLC0415

        if settings.resolved_ark_api_key:
            client = OpenAI(
                api_key=settings.resolved_ark_api_key,
                base_url=settings.ark_api_base.rstrip("/"),
            )
        elif (settings.cloud_api_key or "").strip():
            kwargs: dict[str, str] = {"api_key": settings.cloud_api_key.strip()}
            base = (settings.cloud_base_url or "").strip()
            if base:
                kwargs["base_url"] = base.rstrip("/")
            client = OpenAI(**kwargs)
        else:
            return None

        resp = client.embeddings.create(model=model, input=list(texts))
        out: list[list[float]] = []
        for item in resp.data:
            vec = [float(x) for x in item.embedding]
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("embedding API failed, fallback to local hash: %s", exc)
        return None


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    cleaned = [(t or "").strip()[:8000] or " " for t in texts]
    api = _api_embed(cleaned)
    if api is not None and len(api) == len(cleaned):
        return api
    dim = embedding_dim()
    return [_hash_embed(t, dim=dim) for t in cleaned]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    return float(sum(float(a[i]) * float(b[i]) for i in range(n)))
