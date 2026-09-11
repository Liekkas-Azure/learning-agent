"""
知识编译 Agent：长文档/PDF 正文降噪 + 分层采样 + 大模型提示约束 + 标签后处理。
"""

from __future__ import annotations

from app.knowledge_preprocess import filter_noise_tags, prepare_long_document_for_extraction


class KnowledgeExtractAgent:
    """编排「清洗正文 → 采样 → 提示词约束 → 标签过滤」。"""

    @staticmethod
    def prepare_body(raw_text: str, *, max_chars: int = 24_000) -> str:
        return prepare_long_document_for_extraction(raw_text, max_chars=max_chars)

    @staticmethod
    def user_prompt_prefix() -> str:
        return (
            "你根据下面「文档正文」做知识整理。正文可能来自电子书/扫描 PDF，"
            "夹杂页眉页脚、重复广告语（如引导关注公众号、免费下载资料）、"
            "目录与页码（如「页码：1 / 160」、行末「………3」）。这些版式噪声不是图书主题，"
            "摘要与标签必须基于实质性技术内容推断，不要被上述噪声带偏。\n"
            "标签应体现领域与技术实质（例如：大模型落地、RAG、Agent、多模态、"
            "检索增强、业务场景如研发效能/金融风控等），用简短名词或短语（每条建议 2～12 字）。\n"
            "禁止输出：营销推广语、纯页码、整句目录标题照搬、与正文技术无关的水印话术。\n"
            "只输出一个 JSON 对象，不要 markdown 代码块、不要解释文字。\n"
            "字段：\n"
            "- summary: 2～5 句，概括全书/全文的**技术主题与价值**，与原文语言一致。\n"
            "- tags: 若干短标签（数量不限，以覆盖主题为准）；英文词用小写；中文优先。\n"
            "- insights: 若干条简短要点字符串（可选）。\n"
            "- concepts: 3～20 个核心知识点，使用稳定、可复用的名词短语。\n"
            "- prerequisites: 仅输出正文有依据的先修边；before 是先学知识点，after 是后学知识点，"
            "confidence 为 0～1。不要仅按标签顺序臆造关系。\n"
            'Schema: {"summary":"...","tags":["..."],"insights":["..."],'
            '"concepts":["..."],"prerequisites":[{"before":"...","after":"...","confidence":0.8}]}\n\n'
            "文档正文：\n"
        )

    @staticmethod
    def refine_tags(tags: list[str]) -> list[str]:
        """剔除营销/版式类误标，保留顺序与上限。"""
        return filter_noise_tags(tags)
