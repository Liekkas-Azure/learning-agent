"""费曼会话 API"""

import uuid

from sqlmodel import Session

from app.models import KnowledgeFlashcard
from app.storage import engine, init_db, save_record


def test_feynman_brief_and_evaluate(monkeypatch):
    init_db()
    suffix = uuid.uuid4().hex[:8]
    rec = save_record(
        "feynman-demo.pdf",
        "/tmp/feynman-demo.pdf",
        "这是一段足够长的摘要，用于测试费曼讲解。分布式系统需要在不可靠网络上保持一致性，"
        "CAP 定理说明在分区发生时只能在一致性与可用性之间权衡。",
        ["分布式", "CAP"],
    )
    with Session(engine) as session:
        card = KnowledgeFlashcard(
            content_key=f"test:feynman:cap:{suffix}",
            card_kind="summary",
            wiki_file_name="feynman-demo.md",
            topic="分布式",
            topics_csv="分布式,CAP",
            front_text="CAP 定理说了什么？",
            back_text="在分区发生时，系统不能同时保证强一致性与可用性，只能二选一或折中。",
            source_title=rec.file_name,
            active=True,
            user_id="__default__",
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        card_id = card.id

    from fastapi.testclient import TestClient

    from app import main as main_mod
    from app.feynman_session import build_feynman_brief, evaluate_feynman_explanation

    brief = build_feynman_brief(card_id)
    assert "CAP" in brief["concept"] or "CAP" in brief["prompt"]

    def _fake_openai():
        payload = (
            '{"passed": true, "score": 85, "coach_message": "讲清楚了", '
            '"gaps": [], "strengths": ["因果清楚"], "reference_points": ["分区时二选一"]}'
        )

        class _Msg:
            content = payload

        class _Resp:
            choices = [type("C", (), {"message": _Msg()})()]

        class _Completions:
            @staticmethod
            def create(**_kwargs):
                return _Resp()

        class _Chat:
            completions = _Completions()

        class _Client:
            chat = _Chat()

        return _Client(), "m", "cloud"

    monkeypatch.setattr("app.feynman_session._openai_client_and_model", _fake_openai)

    result = evaluate_feynman_explanation(
        card_id,
        explanation="分区时系统只能在一致性和可用性里选一个，就像两边不能同时满分。",
        attempt=1,
    )
    assert result["passed"] is True
    assert result["score"] >= 78

    client = TestClient(main_mod.app)
    res = client.get(f"/api/v1/flashcards/{card_id}/feynman/brief")
    assert res.status_code == 200
    body = res.json()
    assert body["brief"]["card_id"] == card_id
