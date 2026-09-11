"""内置示例闪卡：零语料即可体验推荐流。

精选 5 张跨领域「复杂原理 → 一句话讲透」卡，目标是在用户上传前制造 aha 时刻。
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.storage import engine
from app.models import KnowledgeFlashcard
from app.tenant import SYSTEM_USER_ID

DEMO_WIKI = "__demo__"

DEMO_SPECS: list[dict[str, str]] = [
    {
        "content_key": "demo:entropy",
        "topic": "物理学",
        "front_text": "碎掉的杯子绝不可能自己拼回去——但单个分子的运动不是「可逆」的吗？",
        "back_text": (
            "单个粒子轨迹可以倒放；**宏观**上却几乎永远越变越乱。\n\n"
            "关键在统计：有序态只是全部微观排列中的极少数。碎成千百块后，"
            "「刚好拼回原样」的概率 ≈ 0。**熵**衡量「有多乱」——可能微观态越多，熵越高。\n\n"
            "热力学第二定律：封闭系统大概率走向更无序。"
            "不是某条律令禁止拼杯，而是**乱的状态占绝对多数**。\n\n"
            "💡 **Aha**：时间箭头来自统计，不是分子「记不住」过去。"
        ),
        "visual_caption": "熵 · 时间箭头",
        "visual_emoji": "🌡️",
        "visual_palette": "ocean",
    },
    {
        "content_key": "demo:marginal-opportunity",
        "topic": "经济学",
        "front_text": "第 8 片披萨免费，你为什么往往不该要？",
        "back_text": (
            "因为理性决策看**边际**，不是看总量。\n\n"
            "第 1 片解饿，**边际效用**最高；第 8 片可能只是负担。"
            "应停在：下一块的额外快乐 ≈ 额外成本（热量、饱胀、时间）。\n\n"
            "同时记住**机会成本**：选 A 的真正代价，是你本可以做的**最好替代**。"
            "免费会议 ≠ 零成本——它占用了写代码、陪家人、休息的时间。\n\n"
            "💡 **Aha**：「免费」常常偷走的是边际最高的那几小时。"
        ),
        "visual_caption": "边际 · 机会成本",
        "visual_emoji": "📊",
        "visual_palette": "sunset",
    },
    {
        "content_key": "demo:dna-semiconservative",
        "topic": "生物学",
        "front_text": "一个 DNA 双螺旋要复制成两个，怎样保证遗传信息不丢、不混？",
        "back_text": (
            "**半保留复制**——像拉链拆开，每条旧链当模板各「带写」一条新链：\n\n"
            "1. 双链解开；\n"
            "2. 旧链按 A↔T、G↔C 配对，**新长**互补链；\n"
            "3. 每个新 DNA = **一条父链 + 一条子链**。\n\n"
            "若全用旧料或全重写，出错就无法对照纠错。"
            "1958 Meselson-Stahl 用同位素标记证明：新 DNA 密度居中——正是半保留，"
            "而非「全新合成」或「全用旧链」。\n\n"
            "💡 **Aha**：遗传不是复印整本书，而是「每条旧链带写一条新链」。"
        ),
        "visual_caption": "DNA · 半保留复制",
        "visual_emoji": "🧬",
        "visual_palette": "forest",
    },
    {
        "content_key": "demo:public-key-crypto",
        "topic": "计算机科学",
        "front_text": "公钥可以贴在网站上，为什么陌生人还是无法冒充你的数字签名？",
        "back_text": (
            "想象**开顶邮箱**：投递口（**公钥**）公开，谁都能往里塞信；"
            "只有你有私钥，能开箱取信或盖章。\n\n"
            "数学上靠**单向陷阱**：两个大质数相乘很容易；"
            "把乘积分解回质数，在现有算力下几乎不可行。\n\n"
            "私钥签名 = 做一步「有钥匙易做、没钥匙难逆推」的运算。"
            "别人只有公钥，无法反推私钥，也无法伪造你的签名。\n\n"
            "💡 **Aha**：公开的不是秘密本身，而是「只能单向通过的门」。"
        ),
        "visual_caption": "公钥 · 单向函数",
        "visual_emoji": "🔐",
        "visual_palette": "grape",
    },
    {
        "content_key": "demo:bayes-base-rate",
        "topic": "统计学",
        "front_text": "检测准确率 99%，结果阳性——你真的有 99% 概率得病吗？",
        "back_text": (
            "不一定。还得看**基础率**——这种病在人群里有多常见。\n\n"
            "例：患病率 **0.1%**，万人中真病约 10 人、健康 9990 人。"
            "检测 99% 准确 → 约 10 真阳性 + **9900×1% ≈ 99 假阳性**。\n\n"
            "阳性 109 人里，真病约 10 → **真正患病的概率 ≈ 9%**，不是 99%！\n\n"
            "**贝叶斯**：后验 ∝ 先验 × 似然。病越稀有，阳性里误报越容易淹没真信号。\n\n"
            "💡 **Aha**：「测得准不准」和「阳性有多可信」是两回事。"
        ),
        "visual_caption": "贝叶斯 · 基础率",
        "visual_emoji": "🎯",
        "visual_palette": "rose",
    },
]

_DEMO_KEYS = {s["content_key"] for s in DEMO_SPECS}


def _apply_spec(card: KnowledgeFlashcard, spec: dict[str, str]) -> None:
    card.user_id = SYSTEM_USER_ID
    card.card_kind = "qa"
    card.wiki_file_name = DEMO_WIKI
    card.section_id = spec["content_key"].split(":")[-1]
    card.topic = spec["topic"]
    card.front_text = spec["front_text"]
    card.back_text = spec["back_text"]
    card.source_title = "Knotory 示例体验"
    card.visual_caption = spec.get("visual_caption", "")
    card.visual_emoji = spec.get("visual_emoji", "")
    card.visual_palette = spec.get("visual_palette", "slate")
    card.quality_score = 1.0
    card.active = True


def ensure_demo_flashcards() -> int:
    """插入或更新示例卡，下线旧版 demo，返回活跃 demo 卡数量。"""
    with Session(engine) as session:
        for spec in DEMO_SPECS:
            existing = session.exec(
                select(KnowledgeFlashcard).where(KnowledgeFlashcard.content_key == spec["content_key"])
            ).first()
            if existing is not None:
                _apply_spec(existing, spec)
                session.add(existing)
            else:
                card = KnowledgeFlashcard(content_key=spec["content_key"])
                _apply_spec(card, spec)
                session.add(card)

        all_demo = session.exec(
            select(KnowledgeFlashcard).where(KnowledgeFlashcard.wiki_file_name == DEMO_WIKI)
        ).all()
        for row in all_demo:
            if row.content_key not in _DEMO_KEYS:
                row.active = False
                session.add(row)

        session.commit()

        rows = list(
            session.exec(
                select(KnowledgeFlashcard)
                .where(KnowledgeFlashcard.wiki_file_name == DEMO_WIKI)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
            )
        )
    return len(rows)


def list_demo_flashcards() -> list[KnowledgeFlashcard]:
    ensure_demo_flashcards()
    key_order = [s["content_key"] for s in DEMO_SPECS]
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(KnowledgeFlashcard)
                .where(KnowledgeFlashcard.wiki_file_name == DEMO_WIKI)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
            )
        )
    order_map = {k: i for i, k in enumerate(key_order)}
    rows.sort(key=lambda c: order_map.get(c.content_key, 999))
    return rows
