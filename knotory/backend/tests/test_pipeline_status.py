"""Pipeline 状态 API 冒烟测试。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


def test_pipeline_status_shape():
    with patch("app.pipeline_status.build_pipeline_status") as mock_build:
        mock_build.return_value = {
            "ingest": {"active": [], "recent": [], "active_count": 0},
            "flashcard_sync": {"running": False, "stage": "idle"},
            "wiki_items": [],
            "totals": {"records": 0, "active_flashcards": 0, "wikis_with_cards": 0},
        }
        with TestClient(app) as client:
            res = client.get("/api/v1/pipeline/status")
        assert res.status_code == 200
        body = res.json()
        assert "ingest" in body
        assert "flashcard_sync" in body
        assert "totals" in body
