from app.contradiction_list import list_contradictions
from app.storage import init_db, save_record


def test_list_contradictions_returns_list():
    init_db()
    items = list_contradictions(limit=10)
    assert isinstance(items, list)
    for item in items:
        assert "record_id" in item
        assert "other_record_id" in item


def test_list_contradictions_from_records():
    init_db()
    save_record(
        "conflict-a.pdf",
        "/tmp/a",
        "summary a",
        ["tag1", "tag2"],
        contradictions=[
            {
                "other_record_id": 99,
                "overlap_tags": ["tag1"],
                "note": "观点冲突测试",
            }
        ],
    )
    items = list_contradictions(limit=10)
    assert len(items) >= 1
    hit = next((x for x in items if x["note"] == "观点冲突测试"), None)
    assert hit is not None
    assert hit["other_record_id"] == 99
    assert "tag1" in hit["overlap_tags"]
