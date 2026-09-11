"""向量记忆：默认 SQLite 本地库；配置 Milvus 时优先写入/检索。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.config import settings
from app.embeddings import cosine, embed_text, embed_texts
from app.models import VectorChunk
from app.storage import engine
from app.tenant import current_user_id

logger = logging.getLogger("knotory.vector_store")
_milvus_client_instance: Any = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _chunk_key(source_kind: str, source_ref: str, idx: int) -> str:
    return f"{source_kind}:{source_ref}:{idx}"[:300]


def _split_chunks(text: str, *, max_chars: int = 700) -> list[str]:
    body = (text or "").strip()
    if not body:
        return []
    parts = re.split(r"\n{2,}|(?=^#{1,3}\s)", body, flags=re.M)
    chunks: list[str] = []
    buf = ""
    for part in parts:
        p = part.strip()
        if not p:
            continue
        if len(buf) + len(p) + 1 <= max_chars:
            buf = f"{buf}\n{p}".strip()
            continue
        if buf:
            chunks.append(buf)
        if len(p) <= max_chars:
            buf = p
        else:
            for i in range(0, len(p), max_chars):
                chunks.append(p[i : i + max_chars])
            buf = ""
    if buf:
        chunks.append(buf)
    return chunks[:40]


def _milvus_enabled() -> bool:
    return (getattr(settings, "vector_backend", "local") or "local").lower() == "milvus" and bool(
        (getattr(settings, "milvus_uri", "") or "").strip()
    )


def upsert_document_chunks(
    *,
    source_kind: str,
    source_ref: str,
    title: str,
    text: str,
) -> int:
    """将文档切块并写入向量库（本地 + 可选 Milvus）。"""
    chunks = _split_chunks(text)
    if not chunks:
        return 0
    owner = current_user_id()
    embeddings = embed_texts(chunks)

    with Session(engine) as session:
        # 清理旧块
        old = list(
            session.exec(
                select(VectorChunk).where(
                    VectorChunk.user_id == owner,
                    VectorChunk.source_kind == source_kind,
                    VectorChunk.source_ref == source_ref,
                )
            )
        )
        for row in old:
            session.delete(row)

        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            row = VectorChunk(
                user_id=owner,
                chunk_key=_chunk_key(source_kind, source_ref, i),
                source_kind=source_kind,
                source_ref=source_ref,
                title=(title or source_ref)[:512],
                text=chunk,
                embedding_json=json.dumps(emb),
                updated_at=_utcnow(),
            )
            session.add(row)
        session.commit()

    if _milvus_enabled():
        try:
            _milvus_upsert(source_kind=source_kind, source_ref=source_ref, title=title, chunks=chunks, embeddings=embeddings)
        except Exception as exc:  # noqa: BLE001
            logger.warning("milvus upsert failed, local store kept: %s", exc)

    return len(chunks)


def search_vectors(query: str, *, limit: int = 12) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []

    if _milvus_enabled():
        try:
            hits = _milvus_search(q, limit=limit)
            if hits:
                return hits
        except Exception as exc:  # noqa: BLE001
            logger.warning("milvus search failed, fallback local: %s", exc)

    q_emb = embed_text(q)
    owner = current_user_id()
    with Session(engine) as session:
        rows = list(session.exec(select(VectorChunk).where(VectorChunk.user_id == owner).limit(800)))

    scored: list[tuple[float, VectorChunk]] = []
    for row in rows:
        try:
            emb = json.loads(row.embedding_json or "[]")
        except json.JSONDecodeError:
            continue
        if not isinstance(emb, list) or not emb:
            continue
        scored.append((cosine(q_emb, emb), row))
    scored.sort(key=lambda x: -x[0])

    out: list[dict[str, Any]] = []
    for score, row in scored[:limit]:
        if score < 0.05:
            continue
        out.append(
            {
                "kind": "vector",
                "source_kind": row.source_kind,
                "title": row.title or row.source_ref,
                "wiki_file_name": row.source_ref if row.source_kind == "wiki" else "",
                "snippet": (row.text or "")[:280],
                "vector_score": round(float(score), 4),
                "source_ref": row.source_ref,
                "match_reason": "向量语义命中",
            }
        )
    return out


def _milvus_upsert(
    *,
    source_kind: str,
    source_ref: str,
    title: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> None:
    client = _get_milvus_client(dimension=len(embeddings[0]))
    name = getattr(settings, "milvus_collection", "knotory_chunks") or "knotory_chunks"
    owner = current_user_id()
    try:
        client.delete(
            collection_name=name,
            filter=(
                f'user_id == "{_milvus_escape(owner)}" and '
                f'source_ref == "{_milvus_escape(source_ref)}"'
            ),
        )
    except Exception:  # noqa: BLE001
        pass
    rows = []
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        raw_id = f"{owner}:{_chunk_key(source_kind, source_ref, i)}"
        rows.append(
            {
                "id": hashlib.sha256(raw_id.encode("utf-8")).hexdigest(),
                "user_id": owner[:64],
                "source_kind": source_kind[:64],
                "source_ref": source_ref[:512],
                "title": (title or source_ref)[:512],
                "text": chunk[:8192],
                "embedding": embedding,
            }
        )
    client.upsert(collection_name=name, data=rows)


def _milvus_search(query: str, *, limit: int) -> list[dict[str, Any]]:
    emb = embed_text(query)
    client = _get_milvus_client(dimension=len(emb))
    name = getattr(settings, "milvus_collection", "knotory_chunks") or "knotory_chunks"
    owner = current_user_id()
    res = client.search(
        collection_name=name,
        data=[emb],
        anns_field="embedding",
        search_params={"metric_type": "COSINE", "params": {"nprobe": 10}},
        limit=limit,
        filter=f'user_id == "{_milvus_escape(owner)}"',
        output_fields=["title", "text", "source_ref", "source_kind"],
    )
    out: list[dict[str, Any]] = []
    for hits in res:
        for hit in hits:
            entity = hit.get("entity") or {}
            out.append(
                {
                    "kind": "vector",
                    "source_kind": entity.get("source_kind") or "wiki",
                    "title": entity.get("title") or entity.get("source_ref") or "",
                    "wiki_file_name": entity.get("source_ref") if entity.get("source_kind") == "wiki" else "",
                    "snippet": str(entity.get("text") or "")[:280],
                    "vector_score": round(float(hit.get("distance", 0.0)), 4),
                    "source_ref": entity.get("source_ref") or "",
                    "match_reason": "Milvus 向量命中",
                }
            )
    return out


def _milvus_escape(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def _get_milvus_client(*, dimension: int):
    """延迟创建 collection；启用 Milvus 后无需人工建表。"""
    global _milvus_client_instance
    from pymilvus import DataType, MilvusClient  # noqa: PLC0415

    if _milvus_client_instance is None:
        _milvus_client_instance = MilvusClient(uri=settings.milvus_uri.strip())
    client = _milvus_client_instance
    name = getattr(settings, "milvus_collection", "knotory_chunks") or "knotory_chunks"
    if client.has_collection(collection_name=name):
        return client

    schema = MilvusClient.create_schema(auto_id=False, enable_dynamic_field=False)
    schema.add_field("id", DataType.VARCHAR, is_primary=True, max_length=64)
    schema.add_field("user_id", DataType.VARCHAR, max_length=64)
    schema.add_field("source_kind", DataType.VARCHAR, max_length=64)
    schema.add_field("source_ref", DataType.VARCHAR, max_length=512)
    schema.add_field("title", DataType.VARCHAR, max_length=512)
    schema.add_field("text", DataType.VARCHAR, max_length=8192)
    schema.add_field("embedding", DataType.FLOAT_VECTOR, dim=dimension)
    indexes = client.prepare_index_params()
    indexes.add_index(
        field_name="embedding",
        index_type="AUTOINDEX",
        metric_type="COSINE",
    )
    client.create_collection(
        collection_name=name,
        schema=schema,
        index_params=indexes,
    )
    return client
