import uuid

from sqlmodel import Session

from app.flashcard_understand import apply_flashcard_understanding, fetch_flashcard_understanding
from app.models import KnowledgeFlashcard
from app.storage import engine, init_db


def test_fetch_understanding_explain(monkeypatch):
    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        card = KnowledgeFlashcard(
            content_key=f"test:understand:{suffix}",
            topic="测试",
            front_text="什么是 RAG？",
            back_text="检索增强生成是一种结合检索与生成的方法。" * 8,
            card_kind="qa",
            wiki_file_name="book.md",
            section_id="sec-1",
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        assert card.id

    def fake_llm(**kwargs):
        if kwargs.get("mode") == "explain":
            return (
                {
                    "mode": "explain",
                    "mode_label": "拆解要点",
                    "summary": "RAG 先检索相关资料，再让模型基于资料回答。",
                    "analogy": "就像开卷考试前先翻到相关页。",
                    "key_points": ["先检索", "再生成"],
                },
                "ark",
            )
        return (
            {
                "mode": kwargs.get("mode"),
                "mode_label": "生活类比",
                "question": "RAG 像什么？",
                "answer": "它像带着资料库回答问题的助手。" * 10,
                "analogy": "像开卷考试。",
            },
            "ark",
        )

    monkeypatch.setattr("app.flashcard_understand.generate_understanding_with_llm", fake_llm)
    monkeypatch.setattr(
        "app.flashcard_understand._section_context",
        lambda _c: ("章节", "RAG 检索增强生成。" * 30),
    )

    explain = fetch_flashcard_understanding(card.id, mode="explain")
    assert explain["mode"] == "explain"
    assert "RAG" in explain["summary"]

    analogy = fetch_flashcard_understanding(card.id, mode="analogy")
    assert analogy["mode"] == "analogy"
    assert analogy.get("cached") is False

    cached = fetch_flashcard_understanding(card.id, mode="analogy")
    assert cached.get("cached") is True


def test_apply_understanding_uses_preview(monkeypatch):
    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        card = KnowledgeFlashcard(
            content_key=f"test:apply:{suffix}",
            topic="测试",
            front_text="旧问题？",
            back_text="旧答案内容。" * 12,
            card_kind="qa",
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        assert card.id

    preview = {
        "mode": "analogy",
        "mode_label": "生活类比",
        "question": "新问题：RAG 像什么？",
        "answer": "RAG 就像开卷考试前先翻到相关页，再据此作答。" * 8,
    }
    updated = apply_flashcard_understanding(card.id, mode="analogy", preview=preview)
    assert "新问题" in updated.front_text
    assert "开卷" in updated.back_text
