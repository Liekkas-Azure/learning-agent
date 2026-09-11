"""Student State / Learning Agent 基础测试。"""

from __future__ import annotations

from app.embeddings import cosine, embed_text
from app.student_state import _bkt_update, concept_key_from_label, observe_concept, weak_concepts
from app.agents.learning_graph import run_learning_loop


def test_bkt_update_moves_toward_mastery_on_correct():
    p0 = 0.2
    p1 = _bkt_update(p0, correct=True)
    assert p1 > p0
    p_fail = _bkt_update(p0, correct=False)
    assert p_fail < p1


def test_real_dkt_trains_persists_and_predicts(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from app import dkt

    rows = [
        SimpleNamespace(
            concept_key=f"concept-{i % 3}",
            correct=(i % 4 != 0),
            semantic_score=0.8 if i % 4 != 0 else 0.2,
            dwell_ms=5000 + i * 100,
            evidence_weight=1.0,
        )
        for i in range(12)
    ]
    model_path = tmp_path / "dkt.pt"
    monkeypatch.setattr(dkt, "_load_sequence", lambda limit: rows[-limit:])
    monkeypatch.setattr(dkt, "_model_path", lambda: model_path)
    monkeypatch.setattr(dkt, "current_user_id", lambda: "__dkt_test__")

    result = dkt.train_and_predict("concept-1")
    assert result is not None
    assert result["model"] == "hashed-skill-gru-dkt"
    assert result["trained"] is True
    assert 0.0 < result["probability"] < 1.0
    assert model_path.is_file()

    loaded = dkt.train_and_predict("concept-1", train=False)
    assert loaded is not None
    assert loaded["loaded"] is True


def test_concept_key_normalizes():
    assert concept_key_from_label("  牛顿定律  ") == "牛顿定律"
    assert concept_key_from_label("Bayesian Inference") == "bayesian inference"


def test_observe_and_weak_concepts(monkeypatch):
    from app import student_state as ss
    from app.storage import init_db

    init_db()
    monkeypatch.setattr(ss, "current_user_id", lambda: "__test_student__")
    observe_concept("测试概念A", correct=False, error_patterns=["定义混淆"])
    observe_concept("测试概念A", correct=False)
    observe_concept("测试概念B", correct=True, evidence_weight=1.5)
    weak = weak_concepts(limit=10, threshold=0.9)
    labels = {w["concept_label"] for w in weak}
    assert "测试概念A" in labels


def test_embed_cosine_self_similarity():
    v = embed_text("知识图谱与长期记忆")
    assert abs(cosine(v, v) - 1.0) < 1e-6


def test_learning_loop_returns_trace(monkeypatch):
    from app.agents import learning_graph as lg

    monkeypatch.setattr(lg, "build_student_state_snapshot", lambda use_llm=False: {
        "summary": "需巩固测试概念",
        "weak_concepts": [{"concept_label": "测试概念", "mastery_pct": 20, "p_know": 0.2}],
        "strong_concepts": [],
    })
    monkeypatch.setattr(lg, "list_due_flashcards", lambda limit=12: [])
    monkeypatch.setattr(lg, "weak_concepts", lambda limit=8: [
        {"concept_label": "测试概念", "mastery_pct": 20, "p_know": 0.2}
    ])
    monkeypatch.setattr(lg, "mastery_by_topic", lambda: [])
    monkeypatch.setattr(lg, "list_memory_episodes", lambda limit=5: [])
    monkeypatch.setattr(lg, "arm_stats", lambda: [])
    monkeypatch.setattr(lg, "prerequisite_blockers", lambda labels: [])
    monkeypatch.setattr(
        lg,
        "refine_plan_with_llm",
        lambda **kwargs: kwargs["base_plan"],
    )
    monkeypatch.setattr(lg, "record_reward", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        lg,
        "build_learning_path_heuristic",
        lambda days=7: {
            "days": days,
            "steps": [
                {
                    "day": 1,
                    "title": "demo",
                    "wiki_file_name": "demo.md",
                    "focus_topic": "",
                    "tasks": ["刷卡"],
                    "actions": [{"label": "刷推荐流", "href": "/"}],
                    "why": "",
                }
            ],
            "mastery": [],
            "corpus_count": 1,
            "weak_topics": ["测试概念"],
        },
    )
    monkeypatch.setattr(
        lg,
        "reflect_and_write",
        lambda **kwargs: {"written": False, "value_score": 0.2},
    )
    monkeypatch.setattr(
        lg,
        "choose_teaching_action",
        lambda **kwargs: {
            "action": "feed_review",
            "arguments": {},
            "policy": "test",
        },
    )
    monkeypatch.setattr(
        lg,
        "execute_learning_tool",
        lambda name, **kwargs: {
            "ok": True,
            "action": name,
            "tool": "test_tool",
            "cta": {"label": "测试", "href": "/"},
        },
    )
    # requirements 已包含 LangGraph：这里直接验证图编排路径。
    monkeypatch.setattr(lg, "_COMPILED", None)

    result = run_learning_loop(days=3)
    assert "diagnose" in result["trace"]
    assert "plan" in result["trace"]
    assert "policy" in result["trace"]
    assert "execute" in result["trace"]
    assert result["engine"] == "langgraph"
    assert result["plan"]["primary_action"]
    assert result["execution"]["cta"]["href"]


def test_learning_loop_replans_after_tool_failure(monkeypatch):
    from app.agents import learning_graph as lg

    monkeypatch.setattr(
        lg,
        "build_student_state_snapshot",
        lambda use_llm=False: {
            "summary": "状态",
            "weak_concepts": [],
            "strong_concepts": [],
            "profile": {},
            "observation_sources": {},
        },
    )
    monkeypatch.setattr(lg, "list_due_flashcards", lambda limit=12: [object()])
    monkeypatch.setattr(lg, "weak_concepts", lambda limit=8: [])
    monkeypatch.setattr(lg, "prerequisite_blockers", lambda labels: [])
    monkeypatch.setattr(lg, "mastery_by_topic", lambda: [])
    monkeypatch.setattr(lg, "list_memory_episodes", lambda limit=5: [])
    monkeypatch.setattr(lg, "arm_stats", lambda: [])
    monkeypatch.setattr(
        lg,
        "refine_plan_with_llm",
        lambda **kwargs: kwargs["base_plan"],
    )
    monkeypatch.setattr(lg, "record_reward", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        lg,
        "build_learning_path_heuristic",
        lambda days=7: {
            "days": days,
            "steps": [
                {
                    "day": 1,
                    "title": "demo",
                    "wiki_file_name": "demo.md",
                    "focus_topic": "",
                    "tasks": [],
                    "actions": [],
                }
            ],
        },
    )
    monkeypatch.setattr(
        lg,
        "choose_teaching_action",
        lambda forced_action="", **kwargs: {
            "action": forced_action or "feed_review",
            "arguments": {},
            "policy": "test",
        },
    )

    def execute(name, **kwargs):
        if name == "feed_review":
            return {"ok": False, "error": "模拟工具失败", "retryable": True}
        return {
            "ok": True,
            "action": name,
            "tool": "test_tool",
            "cta": {"label": "继续", "href": "/review"},
        }

    monkeypatch.setattr(lg, "execute_learning_tool", execute)
    monkeypatch.setattr(
        lg,
        "reflect_and_write",
        lambda **kwargs: {"written": True, "value_score": 0.9},
    )
    monkeypatch.setattr(lg, "_COMPILED", None)

    result = run_learning_loop(days=3)
    assert result["engine"] == "langgraph"
    assert "replan" in result["trace"]
    assert result["trace"].count("diagnose") == 2
    assert result["trace"].count("plan") == 2
    assert len(result["execution_history"]) == 2
    assert result["execution"]["ok"] is True
    assert result["plan"]["replanned"] is True
