"""Tests for demo flashcards and daily stats."""

from app.daily_stats import today_progress, compute_streak
from app.demo_flashcards import DEMO_SPECS, ensure_demo_flashcards, list_demo_flashcards
from app.flashcard_feed import record_feedback


def test_ensure_demo_flashcards():
    n = ensure_demo_flashcards()
    assert n == len(DEMO_SPECS)
    again = ensure_demo_flashcards()
    assert again == len(DEMO_SPECS)
    cards = list_demo_flashcards()
    assert len(cards) == len(DEMO_SPECS)
    assert all(c.wiki_file_name == "__demo__" for c in cards)
    topics = {c.topic for c in cards}
    assert len(topics) == len(DEMO_SPECS)


def test_today_progress_counts_feedback():
    from app.tenant import clear_tenant, set_tenant

    set_tenant(user_id="feedback-test-user", email="t@local")
    try:
        cards = list_demo_flashcards()
        assert cards
        session_tag = "test-daily-progress-session"
        record_feedback(flashcard_id=cards[0].id, action="flip", dwell_ms=800, session_id=session_tag)
        stats = today_progress(session_id=session_tag)
        assert stats["today_count"] >= 1
        assert stats["goal"] >= 1
        assert "streak_days" in stats
        assert isinstance(compute_streak(), int)
    finally:
        clear_tenant()
