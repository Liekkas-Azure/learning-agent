"""
标签语义层：将字面不同的同义/近义写法归到同一「主题」，用于关联边与推荐。
可在此扩展簇成员，无需向量服务即可拉近星图与首页关联。
"""

from __future__ import annotations

from typing import Iterable

# (主题 id, 展示名, 成员别名集合) — 成员匹配时做规范化相等；中文不强制小写。
_SEMANTIC_CLUSTERS: tuple[tuple[str, str, frozenset[str]], ...] = (
    ("theme_rag", "RAG / 检索增强", frozenset({
        "rag", "检索增强", "检索增强生成", "向量检索", "retrieval", "retrieval augmented",
        "retrieval augmented generation", "rag 系统", "知识检索",
    })),
    ("theme_agent", "Agent / 智能体", frozenset({
        "agent", "智能体", "ai agent", "autonomous agent", "tool use", "function calling",
    })),
    ("theme_llm", "大模型 / LLM", frozenset({
        "llm", "大模型", "大语言模型", "语言模型", "基础模型", "foundation model", "large language model",
        "生成式 ai", "生成式人工智能", "genai", "generative ai",
    })),
    ("theme_multimodal", "多模态", frozenset({
        "多模态", "multimodal", "vision language", "图文", "跨模态",
    })),
    ("theme_finetune", "微调 /对齐", frozenset({
        "微调", "fine-tuning", "finetune", "sft", "对齐", "alignment", "rlhf", "dpo",
    })),
    ("theme_eval", "评测 / 安全", frozenset({
        "评测", "评估", "evaluation", "benchmark", "安全", "对齐安全", "guardrails", "red team",
    })),
    ("theme_moe", "MoE / 稀疏", frozenset({
        "moe", "mixture of experts", "稀疏激活", "专家混合",
    })),
    ("theme_infra", "推理 / 部署", frozenset({
        "推理", "inference", "部署", "serving", "gpu", "算力", "量化", "quantization", "蒸馏", "distillation",
    })),
    ("theme_data", "数据 / 语料", frozenset({
        "数据", "语料", "dataset", "数据清洗", "标注", "合成数据",
    })),
    ("theme_product", "产品 / 落地", frozenset({
        "落地", "业务落地", "产品化", "工程化", "生产环境", "私有化", "saas", "b端",
    })),
    ("theme_finance", "金融风控", frozenset({
        "金融", "风控", "金融风控", "反欺诈", "信贷", "合规",
    })),
    ("theme_dev", "研发效能", frozenset({
        "研发", "研发效能", "软件工程", "代码", "ci/cd", "devops", "developer", "程序员",
    })),
)

def _norm_key(s: str) -> str:
    """Unicode 友好规范化（英文大小写折叠）。"""
    return (s or "").strip().casefold()


_MEMBER_TO_THEME: dict[str, tuple[str, str]] = {}
for tid, label, members in _SEMANTIC_CLUSTERS:
    for m in members:
        k = _norm_key(m)
        if k:
            _MEMBER_TO_THEME[k] = (tid, label)


def theme_id_for_tag(tag: str) -> str | None:
    """若标签属于某一语义簇，返回主题 id。"""
    k = _norm_key(tag)
    if not k:
        return None
    hit = _MEMBER_TO_THEME.get(k)
    if hit:
        return hit[0]
    return None


def theme_label(theme_id: str) -> str:
    for tid, label, _ in _SEMANTIC_CLUSTERS:
        if tid == theme_id:
            return label
    return theme_id


def theme_ids_for_tags(tags: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for t in tags:
        tid = theme_id_for_tag(t)
        if tid:
            out.add(tid)
    return out


def doc_association_overlap(
    tags_a: set[str],
    tags_b: set[str],
) -> tuple[list[str], list[str]]:
    """
    返回 (字面共同标签, 语义主题展示名列表)。
    语义主题指：两册在该主题簇上均有至少一个成员标签（字面可不同）。
    """
    literal = sorted(tags_a & tags_b)
    ta, tb = theme_ids_for_tags(tags_a), theme_ids_for_tags(tags_b)
    overlap_ids = ta & tb
    themes = sorted({theme_label(i) for i in overlap_ids})
    return literal, themes


def docs_linked_by_tags_or_semantics(tags_a: set[str], tags_b: set[str]) -> bool:
    literal, themes = doc_association_overlap(tags_a, tags_b)
    return bool(literal) or bool(themes)
