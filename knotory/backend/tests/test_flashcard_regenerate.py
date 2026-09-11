from app.flashcard_regenerate import regenerate_flashcard
from app.models import KnowledgeFlashcard


def test_regenerate_flashcard_updates_content(monkeypatch):
    card = KnowledgeFlashcard(
        id=1,
        content_key="qa:test.md:sec:0",
        card_kind="qa",
        wiki_file_name="test.md",
        section_id="wiki-sec-intro",
        topic="测试",
        topics_csv="测试",
        front_text="旧问题是什么？",
        back_text="旧答案" * 12,
        source_title="test.md",
        active=True,
    )

    monkeypatch.setattr(
        "app.flashcard_regenerate.read_body_text_for_reading_companion",
        lambda _w: "# Intro\n\n" + ("分布式系统可观测性实践要点。" * 20),
    )

    def fake_regen(**_kwargs):
        return (
            {
                "question": "新版问题：可观测性要解决什么？",
                "answer": "新版答案：" + "帮助理解系统运行状态。" * 4,
            },
            "ark",
        )

    monkeypatch.setattr("app.flashcard_regenerate.regenerate_card_with_llm", fake_regen)

    class FakeSession:
        def __init__(self, _engine):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, model, pk):
            if model is KnowledgeFlashcard and pk == 1:
                return card
            if model.__name__ == "FlashcardUserNote":
                return None
            return None

        def add(self, _row):
            return None

        def commit(self):
            return None

        def refresh(self, _row):
            return None

    monkeypatch.setattr("app.flashcard_regenerate.Session", FakeSession)

    out = regenerate_flashcard(1, direction="用更短的生活类比", use_note=False)
    assert out.front_text.startswith("新版问题")
    assert "新版答案" in out.back_text
