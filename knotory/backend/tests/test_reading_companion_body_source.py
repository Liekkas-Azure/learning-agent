"""read_body_text_for_reading_companion 与沉浸式正文来源一致。"""

from unittest.mock import patch

from app.storage import read_body_text_for_reading_companion


def test_prefers_ai_formatted_over_extracted():
    with (
        patch("app.storage.read_raw_ai_formatted_for_wiki", return_value="  AI正文  "),
        patch("app.storage.read_raw_extracted_for_wiki", return_value="RAW"),
        patch("app.storage.read_wiki_doc", return_value="WIKI"),
    ):
        assert read_body_text_for_reading_companion("book.md").strip() == "AI正文"


def test_falls_back_to_extracted_then_wiki():
    with (
        patch("app.storage.read_raw_ai_formatted_for_wiki", return_value=None),
        patch("app.storage.read_raw_extracted_for_wiki", return_value="  RAW  "),
        patch("app.storage.read_wiki_doc", return_value="WIKI"),
    ):
        assert read_body_text_for_reading_companion("book.md").strip() == "RAW"


def test_falls_back_to_wiki_when_no_raw():
    with (
        patch("app.storage.read_raw_ai_formatted_for_wiki", return_value=None),
        patch("app.storage.read_raw_extracted_for_wiki", return_value=None),
        patch("app.storage.read_wiki_doc", return_value="# Wiki\n"),
    ):
        assert read_body_text_for_reading_companion("book.md").startswith("# Wiki")
