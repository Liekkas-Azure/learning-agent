"""PDF 文本层提取、魔数识别与占位符检测。"""

from __future__ import annotations

import io
from pathlib import Path

import pytest


def _make_text_pdf_bytes(body: str | None = None) -> bytes:
    # 默认正文长度超过 KNOTORY_PDF_OCR_MIN_CHARS，避免单测触发逐页识图（慢且依赖外网）
    text = ("Knotory PDF body segment. " * 3) if body is None else body
    import fitz  # noqa: PLC0415

    doc = fitz.open()
    doc.new_page()
    doc[0].insert_text((72, 100), text)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def test_pdf_text_layer_extracted(tmp_path: Path) -> None:
    from app import parser

    pdf_bytes = _make_text_pdf_bytes("Annual report Knotory-2026 " + "pad " * 20)
    src = tmp_path / "report.source"
    src.write_bytes(pdf_bytes)

    text = parser.extract_text(src, original_filename="report.pdf")
    assert "Knotory-2026" in text
    assert not parser.pdf_extraction_is_placeholder(text)


def test_pdf_magic_bytes_when_filename_has_no_pdf_suffix(tmp_path: Path) -> None:
    from app import parser

    pdf_bytes = _make_text_pdf_bytes("magic-bytes-sniff-ok " + "w " * 30)
    src = tmp_path / "blob.source"
    src.write_bytes(pdf_bytes)

    text = parser.extract_text(src, original_filename="upload")
    assert "magic-bytes-sniff-ok" in text


def test_pdf_placeholder_detection() -> None:
    from app import parser

    assert parser.pdf_extraction_is_placeholder("")
    assert parser.pdf_extraction_is_placeholder("(扫描 PDF 需配置 ARK")
    assert not parser.pdf_extraction_is_placeholder("真实正文\n第二段")
