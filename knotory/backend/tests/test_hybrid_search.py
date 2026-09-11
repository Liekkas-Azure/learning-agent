from app.hybrid_search import search_corpus_hybrid


def test_hybrid_search_empty_query():
    assert search_corpus_hybrid("") == []
    assert search_corpus_hybrid("a") == []


def test_hybrid_search_returns_list():
    hits = search_corpus_hybrid("测试检索", limit=5)
    assert isinstance(hits, list)
    for h in hits:
        assert "kind" in h
        assert "title" in h
        assert "snippet" in h
