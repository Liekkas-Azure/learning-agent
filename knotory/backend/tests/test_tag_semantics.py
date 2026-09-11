from app.tag_semantics import doc_association_overlap, theme_id_for_tag


def test_theme_id_maps_synonyms():
    assert theme_id_for_tag("RAG") == theme_id_for_tag("检索增强") == theme_id_for_tag("rag")


def test_doc_association_semantic_only():
    literal, themes = doc_association_overlap({"RAG", "foo"}, {"检索增强", "bar"})
    assert literal == []
    assert "RAG / 检索增强" in themes


def test_doc_association_literal_and_semantic():
    """字面不完全相同，仍可因同义簇连上。"""
    literal, themes = doc_association_overlap({"RAG", "agent"}, {"rag", "智能体"})
    assert literal == []
    assert "RAG / 检索增强" in themes
    assert "Agent / 智能体" in themes
