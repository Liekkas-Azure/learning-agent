from types import SimpleNamespace
from unittest.mock import MagicMock


def test_build_record_associations_shared_tags(monkeypatch):
    import app.associations as assoc

    r1 = SimpleNamespace(id=1, file_name="a.md", tags_csv="rag,llm")
    r2 = SimpleNamespace(id=2, file_name="b.md", tags_csv="rag,agent")
    monkeypatch.setattr(assoc, "list_records", lambda limit: [r1, r2])

    out = assoc.build_record_associations(limit=10)
    assert len(out["edges"]) == 1
    assert out["edges"][0]["shared_tags"] == ["rag"]
    slugs = {n["slug"] for n in out["nodes"]}
    assert slugs == {"a", "b"}


def test_build_record_associations_semantic_bridge(monkeypatch):
    import app.associations as assoc

    r1 = SimpleNamespace(id=1, file_name="a.md", tags_csv="RAG,foo")
    r2 = SimpleNamespace(id=2, file_name="b.md", tags_csv="检索增强,bar")
    monkeypatch.setattr(assoc, "list_records", lambda limit: [r1, r2])

    out = assoc.build_record_associations(limit=10)
    assert len(out["edges"]) == 1
    e = out["edges"][0]
    assert e["shared_tags"] == []
    assert e["via_semantic"] is True
    assert "RAG / 检索增强" in e["semantic_themes"]
