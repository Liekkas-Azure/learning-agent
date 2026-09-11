import base64

import pytest

from app.ark_image import (
    ark_image_config_status,
    build_flashcard_image_prompt,
    generate_and_cache_flashcard_image,
    infer_visual_strategy,
    probe_ark_image_model,
)
from app.config import settings


def test_build_flashcard_image_prompt_pedagogical_not_title():
    p = build_flashcard_image_prompt(
        topic="因果推断",
        section_title="3-4-因果推断在有限资源决策中的应用.md",
        front_text="「Uplift 建模」的核心要点是什么？",
        back_text="Uplift 建模用于估计干预对个体的增量效应，常用于营销与增长场景。",
        visual_caption="知识结构示意",
    )
    assert "3-4-因果推断" not in p
    assert "知识结构" not in p
    assert "思维导图" in p or "禁止" in p
    assert "Uplift" in p or "增量" in p or "干预" in p


def test_build_flashcard_image_prompt_custom_kept_when_pedagogical():
    p = build_flashcard_image_prompt(
        topic="因果推断",
        section_title="Uplift",
        front_text="什么是 uplift？",
        back_text="比较处理组与对照组差异。",
        image_prompt="左右对比：同一用户在收到优惠券前后走向商店的两个瞬间，扁平插画，无文字",
    )
    assert "左右对比" in p
    assert "禁止思维导图" in p or "禁止" in p


def test_build_flashcard_image_prompt_rebuilds_structure_heavy_custom():
    p = build_flashcard_image_prompt(
        topic="RAG",
        section_title="检索增强",
        front_text="RAG 如何工作？",
        back_text="先检索相关文档片段，再交给大模型生成答案。",
        image_prompt="思维导图展示 RAG 知识结构，主题节点与关键词列表",
    )
    assert "关键词列表" in p or "禁止" in p
    assert "检索" in p or "文档" in p


def test_infer_visual_strategy_comparison():
    assert infer_visual_strategy(front_text="两者区别是什么？", back_text="A 与 B 的对比") == "comparison"


def test_infer_visual_strategy_cause_effect():
    assert infer_visual_strategy(back_text="因为混淆变量导致估计偏差") == "cause_effect"


def test_probe_ark_image_model_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ark_api_key", None)
    monkeypatch.setattr(settings, "ark_image_model", None)
    ok, hint = probe_ark_image_model()
    assert ok is False
    assert "未配置" in hint


def test_ark_image_config_status_disabled(monkeypatch):
    monkeypatch.setattr("app.ark_image.settings.flashcard_image_enabled", False)
    st = ark_image_config_status()
    assert st["ready"] is False
    assert "关闭" in st["hint"]


def test_generate_image_caches(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "flashcard_image_enabled", True)
    monkeypatch.setattr(settings, "ark_api_key", "test-key")
    monkeypatch.setattr(settings, "ark_image_model", "img-model")

    png_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 80
    b64 = base64.b64encode(png_bytes).decode()

    class FakeResp:
        status_code = 200

        @property
        def is_success(self):
            return True

        def raise_for_status(self):
            return None

        def json(self):
            return {"data": [{"b64_json": b64}]}

    class FakeClient:
        def __init__(self, timeout=0):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            return FakeResp()

    monkeypatch.setattr("app.ark_image.httpx.Client", FakeClient)

    prompt = build_flashcard_image_prompt(
        topic="测试",
        section_title="章节",
        front_text="为什么会发生这种情况？",
        back_text="因为反馈回路导致系统放大波动。",
    )
    rel1 = generate_and_cache_flashcard_image(content_key="qa:test:1", prompt=prompt)
    rel2 = generate_and_cache_flashcard_image(content_key="qa:test:1", prompt=prompt)
    assert rel1 == rel2
    assert (tmp_path / "outputs" / rel1).is_file()
