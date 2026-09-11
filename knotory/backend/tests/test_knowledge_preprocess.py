"""正文降噪、目录行清洗、标签黑名单。"""

from app.knowledge_preprocess import (
    filter_noise_tags,
    prepare_for_llm,
    prepare_long_document_for_extraction,
)


def test_prepare_removes_qr_marketing_and_page_numbers():
    raw = """扫码关注公众号免费下载资料
腾讯基于RAG 和Agent 技术的混元大模型业务落地实践.....................................3
页码：1 / 160
正文段落：大模型在研发效能中的评估与落地。
扫码关注公众号免费下载资料
"""
    out = prepare_for_llm(raw)
    assert "扫码关注" not in out
    assert "页码" not in out
    assert "混元大模型业务落地实践" in out
    assert "研发效能" in out


def test_dedupe_repeated_watermark():
    wm = "扫码关注公众号免费下载资料"
    # 噪声行整行删除后不应再出现；换常见重复短行测 dedupe
    raw = "\n".join(["页眉-混元实践"] * 6 + ["第二节 RAG 架构。"])
    cleaned = prepare_for_llm(raw.replace("页眉-混元实践", "固定页眉水印"))
    assert cleaned.count("固定页眉水印") <= 2


def test_stratified_long_document():
    filler = "章节内容讨论向量检索与 Agent 编排。" * 400
    raw = "目录与广告段。" * 50 + "\n" + filler + "\n" + "结尾总结。" * 50
    excerpt = prepare_long_document_for_extraction(raw, max_chars=2000)
    assert "中段采样" in excerpt or "后段采样" in excerpt
    assert len(excerpt) <= 2100


def test_filter_noise_tags():
    assert filter_noise_tags(["RAG", "公众号引流", "agent"]) == ["RAG", "agent"]
