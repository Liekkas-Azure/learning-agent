import json

from app.flashcard_llm import (
    _card_needs_retry,
    _coerce_qa_cards,
    _looks_like_excerpt,
    generate_qa_cards_with_llm,
    qa_cards_for_section,
)
from app.flashcards import collect_flashcard_payloads


def test_coerce_qa_cards():
    parsed = {
        "cards": [
            {
                "question": "什么是 RAG 检索增强生成？",
                "answer": "检索增强生成，先召回相关片段再交给大模型生成，适合私有知识库问答。" * 4,
                "visual_mermaid": "mindmap\n  root((RAG))\n    检索\n    生成",
                "visual_caption": "RAG 流程",
            },
            {"question": "短", "answer": "x"},
        ]
    }
    cards = _coerce_qa_cards(parsed, max_cards=3)
    assert len(cards) == 1
    assert "RAG" in cards[0]["question"]
    assert "mindmap" in cards[0].get("visual_mermaid", "")
    assert cards[0].get("visual_caption") == "RAG 流程"


def test_collect_prefers_llm_qa(monkeypatch):
    monkeypatch.setattr("app.flashcards.list_wiki_docs", lambda: [{"name": "book.md"}])
    monkeypatch.setattr(
        "app.flashcards.read_body_text_for_reading_companion",
        lambda _n: "# Intro\n\n" + ("分布式系统可观测性实践。" * 30),
    )
    monkeypatch.setattr("app.flashcards._load_output_tags", lambda _n: ["系统"])
    monkeypatch.setattr("app.flashcards._companion_map", lambda _n: {})
    monkeypatch.setattr("app.flashcards.list_records", lambda limit=200: [])

    def fake_qa(**_kwargs):
        return [{"question": "测试问题是什么？", "answer": "测试答案：" + "内容" * 20}]

    monkeypatch.setattr("app.flashcards.qa_cards_for_section", fake_qa)
    payloads, stats = collect_flashcard_payloads()
    assert stats["qa_cards"] >= 1
    assert any(p["card_kind"] == "qa" for p in payloads)
    assert payloads[0]["front_text"].startswith("测试问题")


def test_qa_cache_skips_second_llm_call(monkeypatch, tmp_path):
    import re

    def fake_cache_path(wiki_name: str, section_id: str):
        safe_sec = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", section_id)[:80] or "sec"
        return tmp_path / f"cache.{safe_sec}.json"

    monkeypatch.setattr("app.flashcard_llm._cache_path", fake_cache_path)
    calls = {"n": 0}

    def fake_gen(**_kwargs):
        calls["n"] += 1
        return [{"question": "这一节的核心概念是什么？", "answer": "A1" + "x" * 130}], "ark"

    monkeypatch.setattr("app.flashcard_llm.generate_qa_cards_with_llm", fake_gen)
    budget = [5]
    text = "章节正文。" * 40
    c1 = qa_cards_for_section(
        wiki_name="a.md",
        section_id="sec-1",
        section_title="T",
        section_text=text,
        topics=["t"],
        llm_budget=budget,
    )
    c2 = qa_cards_for_section(
        wiki_name="a.md",
        section_id="sec-1",
        section_title="T",
        section_text=text,
        topics=["t"],
        llm_budget=budget,
    )
    assert len(c1) == 1
    assert c1 == c2
    assert calls["n"] == 1


def test_collect_parallel_llm_sections(monkeypatch):
    import threading

    monkeypatch.setattr("app.flashcards.settings.flashcard_llm_parallel_workers", 3)
    monkeypatch.setattr("app.flashcards.settings.flashcard_llm_enabled", True)
    section_text = "并发闪卡测试正文。" * 40
    monkeypatch.setattr(
        "app.flashcards.list_wiki_docs",
        lambda: [{"name": "book-a.md"}, {"name": "book-b.md"}],
    )

    def read_body(name: str) -> str:
        title = "Book A" if "a" in name else "Book B"
        return f"# {title}\n\n{section_text}"

    monkeypatch.setattr("app.flashcards.read_body_text_for_reading_companion", read_body)
    monkeypatch.setattr("app.flashcards._load_output_tags", lambda _n: ["系统"])
    monkeypatch.setattr("app.flashcards._companion_map", lambda _n: {})
    monkeypatch.setattr("app.flashcards.list_records", lambda limit=200: [])
    monkeypatch.setattr("app.flashcards.section_has_qa_cache", lambda *_a, **_k: False)

    lock = threading.Lock()
    active = {"n": 0, "max": 0}

    def fake_qa(**kwargs):
        with lock:
            active["n"] += 1
            active["max"] = max(active["max"], active["n"])
        try:
            import time

            time.sleep(0.03)
            sec = kwargs.get("section_id", "")
            return [{"question": f"问题 {sec}？", "answer": "答案：" + "内容" * 25}]
        finally:
            with lock:
                active["n"] -= 1

    monkeypatch.setattr("app.flashcards.qa_cards_for_section", fake_qa)
    payloads, stats = collect_flashcard_payloads()
    assert stats["qa_cards"] >= 2
    assert active["max"] >= 2
    assert any(p["card_kind"] == "qa" for p in payloads)


def test_looks_like_excerpt():
    source = "分布式系统可观测性实践需要指标、日志与链路追踪三者协同。" * 5
    excerpt_answer = source[:120] + source[:120]
    fresh_answer = (
        "为什么线上出了事却找不到根因？因为你看不见系统内部。\n\n"
        "可观测性就像给黑盒装仪表盘：指标看趋势、日志看细节、链路看请求路径。\n\n"
        "💡 Aha：没有三者协同，排障只能靠猜。"
    )
    assert _looks_like_excerpt(excerpt_answer, source)
    assert not _looks_like_excerpt(fresh_answer, source)


def test_card_needs_retry_flags_bland_question():
    source = "正文内容。" * 30
    bland = [{"question": "这一块在讲什么？", "answer": "x" * 130}]
    good = [
        {
            "question": "为什么需要可观测性？",
            "answer": "因为…\n\n就像…\n\n💡 Aha：看得见才排得障。" + "说明" * 50,
        }
    ]
    assert _card_needs_retry(bland, source)
    assert not _card_needs_retry(good, source)

