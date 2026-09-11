from app.graph_enrich import enrich_knotory_graph, related_wiki_slugs
from app.models import IngestRecord


def test_enrich_adds_shared_tag_between_docs():
    payload = {
        "nodes": [
            {"id": "doc:1", "label": "a.md", "group": "document"},
            {"id": "doc:2", "label": "b.md", "group": "document"},
            {"id": "tag:rag", "label": "rag", "group": "tag"},
            {"id": "tag:llm", "label": "llm", "group": "tag"},
        ],
        "links": [
            {"source": "doc:1", "target": "tag:rag", "kind": "TAGGED"},
            {"source": "doc:1", "target": "tag:llm", "kind": "TAGGED"},
            {"source": "doc:2", "target": "tag:rag", "kind": "TAGGED"},
        ],
        "source": "test",
    }
    out = enrich_knotory_graph(payload)
    shared = [ln for ln in out["links"] if ln.get("kind") == "SHARED_TAG"]
    assert len(shared) == 1
    assert shared[0]["shared_count"] == 1
    assert {shared[0]["source"], shared[0]["target"]} == {"doc:1", "doc:2"}


def test_enrich_shared_semantic_between_docs():
    payload = {
        "nodes": [
            {"id": "doc:1", "label": "a.md", "group": "document"},
            {"id": "doc:2", "label": "b.md", "group": "document"},
            {"id": "tag:RAG", "label": "RAG", "group": "tag"},
            {"id": "tag:检索增强", "label": "检索增强", "group": "tag"},
        ],
        "links": [
            {"source": "doc:1", "target": "tag:RAG", "kind": "TAGGED"},
            {"source": "doc:2", "target": "tag:检索增强", "kind": "TAGGED"},
        ],
        "source": "test",
    }
    out = enrich_knotory_graph(payload)
    sem = [ln for ln in out["links"] if ln.get("kind") == "SHARED_SEMANTIC"]
    assert len(sem) == 1
    assert sem[0]["semantic_themes"]


def test_enrich_similar_tag_link():
    payload = {
        "nodes": [
            {"id": "doc:1", "label": "a", "group": "document"},
            {"id": "tag:rag", "label": "rag", "group": "tag"},
            {"id": "tag:rag-pipeline", "label": "rag-pipeline", "group": "tag"},
        ],
        "links": [{"source": "doc:1", "target": "tag:rag", "kind": "TAGGED"}],
        "source": "test",
    }
    out = enrich_knotory_graph(payload)
    sim = [ln for ln in out["links"] if ln.get("kind") == "SIMILAR_TAG"]
    assert len(sim) == 1
    assert {sim[0]["source"], sim[0]["target"]} == {"tag:rag", "tag:rag-pipeline"}


def test_related_wiki_slugs_orders_by_overlap():
    r1 = IngestRecord(id=1, file_name="old-a.md", source_path="/x", tags_csv="rag")
    r2 = IngestRecord(id=2, file_name="old-b.md", source_path="/y", tags_csv="rag,agent,llm")
    slugs = related_wiki_slugs("new.md", ["rag", "agent"], [r2, r1], limit=5)
    assert slugs[0] == "old-b"
    assert "old-a" in slugs
