"""闪卡可视化：主题色、示意图（Mermaid）清洗与模板回退。"""

from __future__ import annotations

import hashlib
import re

_PALETTES = ("sunset", "ocean", "forest", "grape", "sand", "rose", "sky", "slate")

_TOPIC_EMOJI: list[tuple[str, str]] = [
    ("因果", "🔗"),
    ("推断", "📊"),
    ("增长", "📈"),
    ("机器学习", "🤖"),
    ("大模型", "🧠"),
    ("rag", "🔍"),
    ("检索", "🔍"),
    ("agent", "🤝"),
    ("分布式", "🌐"),
    ("系统", "⚙️"),
    ("产品", "💡"),
    ("设计", "✏️"),
    ("金融", "💰"),
    ("历史", "📜"),
    ("论文", "📄"),
    ("实验", "🧪"),
    ("数据", "📦"),
    ("网络", "📡"),
    ("安全", "🛡️"),
    ("优化", "⚡"),
]

_MERMAID_HEAD_RE = re.compile(
    r"^\s*(graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|timeline|pie\s|gitGraph)",
    re.IGNORECASE | re.MULTILINE,
)


def palette_for_topic(topic: str) -> str:
    key = (topic or "未分类").strip() or "未分类"
    h = hashlib.md5(key.encode("utf-8")).hexdigest()
    return _PALETTES[int(h[:8], 16) % len(_PALETTES)]


def emoji_for_topic(topic: str) -> str:
    t = (topic or "").strip().lower()
    for needle, emo in _TOPIC_EMOJI:
        if needle.lower() in t:
            return emo
    return "📚"


def sanitize_mermaid(code: str | None) -> str | None:
    if not code:
        return None
    t = str(code).strip()
    if len(t) < 12 or len(t) > 900:
        return None
    if t.startswith("```"):
        t = re.sub(r"^```(?:mermaid)?\s*\n?", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\n?```\s*$", "", t).strip()
    if "javascript:" in t.lower() or "<script" in t.lower():
        return None
    if not _MERMAID_HEAD_RE.search(t):
        return None
    if t.lower().startswith("mindmap"):
        t = _repair_mindmap_mermaid(t)
    return t


def _repair_mindmap_mermaid(code: str) -> str:
    lines = code.split("\n")
    out = [lines[0] if lines else "mindmap"]
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            out.append(line)
            continue
        indent = line[: len(line) - len(line.lstrip())]
        if stripped.startswith("root") or stripped.startswith("((") or stripped[0] in "\"'":
            out.append(line)
            continue
        if re.search(r"[^\w\s\u4e00-\u9fff-]", stripped) or re.search(r"[\u4e00-\u9fff]", stripped):
            label = stripped.strip("\"'")
            out.append(f'{indent}("{label.replace(chr(34), chr(39))}")')
            continue
        out.append(line)
    return "\n".join(out)


def heuristic_mermaid(*, title: str, topics: list[str]) -> str | None:
    """无 LLM 图示时的简单思维导图。"""
    root = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", (title or "本节"))[:24] or "本节"
    tags = [x.strip() for x in topics if x.strip()][:5]
    if len(tags) < 2:
        tags = [root, "要点", "应用"]
    lines = ["mindmap", f"  root(({root}))"]
    for tag in tags:
        safe = re.sub(r"[\[\](){}]", "", tag)[:16]
        if safe:
            lines.append(f"    {safe}")
    return "\n".join(lines)


def visual_bundle_for_card(
    *,
    topic: str,
    topics: list[str],
    section_title: str,
    visual_mermaid: str | None = None,
    visual_caption: str | None = None,
) -> dict[str, str]:
    mermaid = sanitize_mermaid(visual_mermaid) or heuristic_mermaid(title=section_title, topics=topics or [topic])
    caption = (visual_caption or "").strip()
    if not caption and mermaid:
        caption = "辅助理解示意"
    return {
        "visual_mermaid": mermaid or "",
        "visual_caption": caption,
        "visual_palette": palette_for_topic(topic),
        "visual_emoji": emoji_for_topic(topic),
    }
