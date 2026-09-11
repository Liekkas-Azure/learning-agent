from app.corpus_search import search_corpus


def test_search_corpus_empty_query():
    assert search_corpus("") == []
    assert search_corpus("a") == []
