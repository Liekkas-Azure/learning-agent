from app.markdown_sections import (
    resolve_flashcard_split_params,
    split_coarse_sections_for_flashcards,
    split_markdown_into_sections,
    split_sections_for_flashcards,
)


def test_split_respects_fenced_headings():
    md = "```\n# not a heading\n```\n\n# Real\n\nbody"
    secs = split_markdown_into_sections(md)
    titles = [s.title for s in secs]
    assert "Real" in titles


def test_coarse_split_ignores_h3():
    md = "# Chapter\n\nintro\n\n## Part A\n\naaa\n\n### Detail 1\n\nbbb\n\n### Detail 2\n\nccc"
    secs = split_coarse_sections_for_flashcards(md, min_chars=0, max_heading_level=2)
    titles = [s.title for s in secs]
    assert "Part A" in titles
    part = next(s for s in secs if s.title == "Part A")
    assert "### Detail 1" in part.markdown
    assert "### Detail 2" in part.markdown


def test_coarse_cap_sections_per_wiki():
    parts = [f"# Chapter {i}\n\n" + ("word " * 400) for i in range(8)]
    md = "\n\n".join(parts)
    secs = split_coarse_sections_for_flashcards(md, min_chars=0, max_heading_level=1, max_sections=4)
    assert len(secs) == 4


def test_coarse_h1_only_keeps_h2_inside():
    md = "# Chapter\n\nintro\n\n## Part A\n\naaa\n\n## Part B\n\nbbb"
    secs = split_coarse_sections_for_flashcards(md, min_chars=0, max_heading_level=1)
    assert len(secs) == 1
    assert "Part A" in secs[0].markdown
    assert "Part B" in secs[0].markdown


def test_coarse_merge_short_sections():
    md = (
        "## A\n\n"
        + "x" * 100
        + "\n\n## B\n\n"
        + "y" * 100
        + "\n\n## C\n\n"
        + "z" * 900
    )
    secs = split_coarse_sections_for_flashcards(md, min_chars=800, max_heading_level=2)
    assert len(secs) <= 2
    combined = "\n".join(s.markdown for s in secs)
    assert "z" * 50 in combined


def test_plaintext_chapter_split():
    parts = []
    for i in range(1, 6):
        parts.append(f"第{i}章 主题{i}\n\n" + ("知识点内容。" * 80))
    md = "\n\n".join(parts)
    secs = split_sections_for_flashcards(md)
    assert len(secs) >= 4


def test_medium_doc_targets_at_least_twenty_sections():
    class FakeSettings:
        flashcard_section_min_chars = 900
        flashcard_section_max_heading_level = 1
        flashcard_max_sections_per_wiki = 150
        flashcard_large_doc_chars = 25_000
        flashcard_target_chars_per_card = 1500
        flashcard_min_cards_per_wiki = 20

    para = "推荐系统融合排序与多目标优化是工业界常见课题。" * 25
    md = "\n\n".join([para] * 45)
    assert len(md) >= 25_000
    params = resolve_flashcard_split_params(len(md), settings=FakeSettings())
    assert params.min_sections >= 20
    secs = split_sections_for_flashcards(md, settings=FakeSettings())
    assert len(secs) >= 20


def test_large_plaintext_splits_to_many_sections():
    class FakeSettings:
        flashcard_section_min_chars = 900
        flashcard_section_max_heading_level = 1
        flashcard_max_sections_per_wiki = 150
        flashcard_large_doc_chars = 80_000
        flashcard_target_chars_per_card = 1500
        flashcard_min_cards_per_wiki = 20

    para = "分布式系统中的一致性是指在多个副本之间保持数据相同。" * 12
    md = "\n\n".join([para] * 400)
    assert len(md) > 120_000
    params = resolve_flashcard_split_params(len(md), settings=FakeSettings())
    assert params.target_chars > 0
    secs = split_sections_for_flashcards(md, settings=FakeSettings())
    assert len(secs) >= 50
