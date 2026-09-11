from pathlib import Path
import json

from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from openai import APIStatusError

from app.llm import ExtractionNotConfiguredError
from app.main import app
import pytest


@pytest.fixture(autouse=True)
def _stub_ingest_side_effects(monkeypatch):
    monkeypatch.setattr("app.storage.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr("app.ingest_pipeline.settings.ingest_fast_return", False)
    monkeypatch.setattr("app.flashcard_sync_job.start_sync_async", lambda **_k: {"ok": True})
    monkeypatch.setattr("app.ingest_pipeline.try_start_wiki_companion_refresh", lambda *_a, **_k: None)
    monkeypatch.setattr("app.ingest_pipeline.related_wiki_slugs", lambda *_a, **_k: [])


def test_upload_preserves_long_summary_not_truncated_at_1200(monkeypatch):
    """入库摘要不再固定截断 1200 字，抽阅 wiki 才能展示完整 Summary。"""
    long_summary = "甲" * 5000
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr("app.ingest_pipeline.extract_text", lambda *_a, **_k: "正文")
    monkeypatch.setattr("app.ingest_pipeline.parse_code_ast", lambda *_a, **_k: {"symbols": []})
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_with_llm",
        lambda _text: ({"summary": long_summary, "tags": ["t1"]}, "ark"),
    )
    monkeypatch.setattr("app.ingest_pipeline.list_records", lambda **_kwargs: [])
    monkeypatch.setattr("app.ingest_pipeline.detect_contradictions", lambda *_a, **_k: [])
    monkeypatch.setattr("app.ingest_pipeline.write_raw_file", lambda *_a, **_k: "/tmp/raw.txt")
    monkeypatch.setattr(
        "app.ingest_pipeline.format_extracted_body_with_llm",
        lambda text: (f"AI排版:{text[:8]}", "ark", 1),
    )
    monkeypatch.setattr("app.ingest_pipeline.write_raw_ai_formatted_file", lambda *_a, **_k: Path("/tmp/x.ai.txt"))
    monkeypatch.setattr("app.main.write_wiki_file", lambda *_a, **_k: "/tmp/wiki.md")
    monkeypatch.setattr("app.ingest_pipeline.write_output_file", lambda *_a, **_k: "/tmp/out.json")
    monkeypatch.setattr(
        "app.ingest_pipeline.save_record",
        lambda *_a, **_k: SimpleNamespace(
            id=1,
            file_name="long.md",
            status="ok",
            summary=long_summary,
            created_at=SimpleNamespace(isoformat=lambda: "2026-05-01T00:00:00"),
        ),
    )
    monkeypatch.setattr("app.ingest_pipeline.upsert_content_cache", lambda **_kwargs: None)
    monkeypatch.setattr("app.ingest_pipeline.sync_document", lambda *_a, **_k: None)

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("long.md", b"# x\ny\n", "text/markdown")},
        )

    assert res.status_code == 200
    assert len(res.json()["summary"]) == 5000


def test_upload_uses_llm_summary_and_tags(monkeypatch):
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_text", lambda *_args, **_kwargs: "这是正文。讨论分布式系统与可观测性。"
    )
    monkeypatch.setattr("app.ingest_pipeline.parse_code_ast", lambda *_args, **_kwargs: {"symbols": []})
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_with_llm",
        lambda text: (
            {
                "summary": f"LLM摘要:{text[:6]}",
                "tags": ["分布式系统", "可观测性", "告警治理"],
            },
            "ark",
        ),
    )
    monkeypatch.setattr("app.ingest_pipeline.list_records", lambda **_kwargs: [])
    monkeypatch.setattr("app.ingest_pipeline.detect_contradictions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("app.ingest_pipeline.write_raw_file", lambda *_args, **_kwargs: "/tmp/raw.txt")
    monkeypatch.setattr(
        "app.ingest_pipeline.format_extracted_body_with_llm",
        lambda text: (f"AI排版:{text[:8]}", "ark", 1),
    )
    monkeypatch.setattr("app.ingest_pipeline.write_raw_ai_formatted_file", lambda *_a, **_k: Path("/tmp/x.ai.txt"))
    monkeypatch.setattr("app.main.write_wiki_file", lambda *_args, **_kwargs: "/tmp/wiki.md")
    monkeypatch.setattr("app.ingest_pipeline.write_output_file", lambda *_args, **_kwargs: "/tmp/out.json")
    monkeypatch.setattr(
        "app.ingest_pipeline.save_record",
        lambda *_args, **_kwargs: SimpleNamespace(
            id=7,
            file_name="note.md",
            status="ok",
            summary="LLM摘要:这是正文",
            created_at=SimpleNamespace(isoformat=lambda: "2026-05-01T00:00:00"),
        ),
    )
    monkeypatch.setattr("app.ingest_pipeline.upsert_content_cache", lambda **_kwargs: None)
    monkeypatch.setattr("app.ingest_pipeline.sync_document", lambda *_args, **_kwargs: None)

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("note.md", b"# title\nsome body\n", "text/markdown")},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["cached"] is False
    assert body["llm_provider"] == "ark"
    assert body["summary"].startswith("LLM摘要:")
    assert body["tags"] == ["分布式系统", "可观测性", "告警治理"]


def test_upload_cache_hit_skips_llm(monkeypatch):
    cached_payload = {
        "id": 99,
        "file_name": "cached.md",
        "status": "ok",
        "summary": "来自缓存",
        "tags": ["缓存标签"],
        "cached": False,
    }
    monkeypatch.setattr(
        "app.main.get_cache_by_hash",
        lambda _sha: SimpleNamespace(output_json='{"id":99,"file_name":"cached.md","status":"ok","summary":"来自缓存","tags":["缓存标签"],"cached":false}'),
    )
    monkeypatch.setattr(
        "app.main.get_record_by_id",
        lambda rid: SimpleNamespace(id=rid) if rid == 99 else None,
    )

    def _should_not_run(_text):
        raise AssertionError("extract_with_llm should not be called on cache hit")

    monkeypatch.setattr("app.ingest_pipeline.extract_with_llm", _should_not_run)

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("cached.md", b"same bytes", "text/markdown")},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["id"] == cached_payload["id"]
    assert body["summary"] == "来自缓存"
    assert body["tags"] == ["缓存标签"]
    assert body["cached"] is True


def test_upload_returns_503_when_llm_not_configured(monkeypatch):
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr("app.ingest_pipeline.extract_text", lambda *_args, **_kwargs: "正文")
    monkeypatch.setattr("app.ingest_pipeline.parse_code_ast", lambda *_args, **_kwargs: {"symbols": []})
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_with_llm",
        lambda _text: (_ for _ in ()).throw(ExtractionNotConfiguredError("LLM key missing")),
    )

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("no-key.md", b"content", "text/markdown")},
        )

    assert res.status_code == 503
    assert res.json()["detail"] == "LLM key missing"


def test_upload_pdf_returns_422_when_extraction_placeholder(monkeypatch):
    """PDF 未得到有效正文时不应调用大模型做无意义摘要。"""
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_text",
        lambda *_a, **_k: "(empty PDF text layer)",
    )

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("scan.pdf", b"%PDF-1.4 minimal", "application/pdf")},
        )

    assert res.status_code == 422
    assert "未能从 PDF 提取" in res.json()["detail"]


def test_upload_maps_openai_error_to_502(monkeypatch):
    err = APIStatusError(
        "bad auth",
        response=MagicMock(status_code=401, request=MagicMock()),
        body=None,
    )
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _: None)
    monkeypatch.setattr("app.ingest_pipeline.extract_text", lambda *_a, **_k: "正文足够长用于提取。" * 5)
    monkeypatch.setattr("app.ingest_pipeline.parse_code_ast", lambda *_a, **_k: {"symbols": []})
    monkeypatch.setattr("app.ingest_pipeline.extract_with_llm", lambda *_a, **_k: (_ for _ in ()).throw(err))

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("x.md", b"# x\n" + b"y\n" * 20, "text/plain")},
        )

    assert res.status_code == 502
    body = res.json()
    assert "detail" in body
    assert "大模型接口错误" in body["detail"] or "401" in body["detail"]


def test_upload_orphan_content_cache_triggers_full_ingest(monkeypatch):
    """缓存 JSON 里的 id 在库中已不存在时，应删缓存并走完整入库，避免假成功。"""
    orphan = SimpleNamespace(
        output_json=json.dumps(
            {
                "id": 424242,
                "file_name": "gone.md",
                "status": "ok",
                "summary": "stale",
                "tags": [],
                "created_at": "2020-01-01T00:00:00",
                "paths": {"raw": "x", "wiki": "y", "outputs": "z"},
                "contradictions": [],
                "cached": False,
                "content_sha256": "dead",
                "llm_provider": "ark",
            }
        ),
    )
    monkeypatch.setattr("app.main.get_cache_by_hash", lambda _sha: orphan)
    deleted: list[str] = []

    def _del(sha: str) -> bool:
        deleted.append(sha)
        return True

    monkeypatch.setattr("app.main.delete_content_cache_by_sha256", _del)
    monkeypatch.setattr("app.main.get_record_by_id", lambda _rid: None)
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_text", lambda *_args, **_kwargs: "这是正文。讨论分布式系统与可观测性。"
    )
    monkeypatch.setattr("app.ingest_pipeline.parse_code_ast", lambda *_args, **_kwargs: {"symbols": []})
    monkeypatch.setattr(
        "app.ingest_pipeline.extract_with_llm",
        lambda text: (
            {
                "summary": f"LLM摘要:{text[:6]}",
                "tags": ["分布式系统", "可观测性", "告警治理"],
            },
            "ark",
        ),
    )
    monkeypatch.setattr("app.ingest_pipeline.list_records", lambda **_kwargs: [])
    monkeypatch.setattr("app.ingest_pipeline.detect_contradictions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("app.ingest_pipeline.write_raw_file", lambda *_args, **_kwargs: "/tmp/raw.txt")
    monkeypatch.setattr(
        "app.ingest_pipeline.format_extracted_body_with_llm",
        lambda text: (f"AI排版:{text[:8]}", "ark", 1),
    )
    monkeypatch.setattr("app.ingest_pipeline.write_raw_ai_formatted_file", lambda *_a, **_k: Path("/tmp/x.ai.txt"))
    monkeypatch.setattr("app.main.write_wiki_file", lambda *_args, **_kwargs: "/tmp/wiki.md")
    monkeypatch.setattr("app.ingest_pipeline.write_output_file", lambda *_args, **_kwargs: "/tmp/out.json")
    monkeypatch.setattr(
        "app.ingest_pipeline.save_record",
        lambda *_args, **_kwargs: SimpleNamespace(
            id=7,
            file_name="note.md",
            status="ok",
            summary="LLM摘要:这是正文",
            created_at=SimpleNamespace(isoformat=lambda: "2026-05-01T00:00:00"),
        ),
    )
    monkeypatch.setattr("app.ingest_pipeline.upsert_content_cache", lambda **_kwargs: None)
    monkeypatch.setattr("app.ingest_pipeline.sync_document", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.ingest_pipeline.try_start_wiki_companion_refresh", lambda *_a, **_k: None)

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/upload",
            files={"file": ("note.md", b"# title\nsome body\n", "text/markdown")},
        )

    assert res.status_code == 200
    assert len(deleted) == 1
    assert len(deleted[0]) == 64
    body = res.json()
    assert body.get("cached") is False
    assert body["id"] == 7
