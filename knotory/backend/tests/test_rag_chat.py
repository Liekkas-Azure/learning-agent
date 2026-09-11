from app.rag_chat import answer_with_rag


def test_rag_no_hits():
    out = answer_with_rag("xyznonexistentquery12345")
    assert "未找到" in out["answer"]
    assert out["sources"] == []
    assert out["provider"] == "none"


def test_rag_retrieval_only_without_llm(monkeypatch):
    from app.llm import ExtractionNotConfiguredError

    def _boom():
        raise ExtractionNotConfiguredError("no llm")

    monkeypatch.setattr("app.rag_chat._openai_client_and_model", _boom)
    monkeypatch.setattr(
        "app.rag_chat.search_corpus_hybrid",
        lambda q, limit=6: [
            {
                "kind": "wiki",
                "title": "demo.md",
                "snippet": "示例片段内容",
                "wiki_file_name": "demo.md",
            }
        ],
    )
    out = answer_with_rag("示例问题")
    assert out["provider"] == "retrieval_only"
    assert len(out["sources"]) == 1
    assert "demo.md" in out["answer"] or "示例" in out["answer"]
