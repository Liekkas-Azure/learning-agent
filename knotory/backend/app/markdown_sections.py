"""与前端 `markdownSections.ts` 一致的按标题切分逻辑（含 ``` 围栏内忽略 #）。"""

from __future__ import annotations

import re
from dataclasses import dataclass

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

# PDF / Word 抽取正文里常见的章标题行（无 Markdown # 前缀）
_PLAINTEXT_CHAPTER_RE = re.compile(
    r"^(?:"
    r"第[零一二三四五六七八九十百千万\d]+章[：:\s][^\n]{0,48}|"
    r"第[零一二三四五六七八九十百千万\d]+章\s*$|"
    r"(?:Chapter|CHAPTER|Part|PART|Section|SECTION)\s+[\dIVXLC]+[\.:\s][^\n]{0,48}|"
    r"\d{1,2}(?:\.\d{1,2}){0,2}\s+[^\d\n]{4,60}"
    r")$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class MarkdownSection:
    id: str
    title: str
    level: int
    markdown: str


@dataclass(frozen=True)
class FlashcardSplitParams:
    min_chars: int
    max_heading_level: int
    max_sections: int
    target_chars: int
    min_sections: int = 1


def _desired_section_count(total_chars: int, *, settings) -> int:
    """按篇幅估算单篇 wiki 应拆成多少块（≈ 闪卡数）。"""
    min_cards = max(1, int(getattr(settings, "flashcard_min_cards_per_wiki", 20)))
    target_card = max(800, int(getattr(settings, "flashcard_target_chars_per_card", 1500)))
    cap = int(getattr(settings, "flashcard_max_sections_per_wiki", 150))
    if cap <= 0:
        cap = 200
    if total_chars < 4000:
        return min(min_cards, max(1, total_chars // max(1200, target_card)))
    return max(min_cards, min(cap, total_chars // target_card))


def resolve_flashcard_split_params(total_chars: int, *, settings) -> FlashcardSplitParams:
    """按文档体量选择分块粒度：单篇默认目标 ≥20 张闪卡。"""
    large_threshold = max(0, int(getattr(settings, "flashcard_large_doc_chars", 25_000)))
    max_per_wiki = int(getattr(settings, "flashcard_max_sections_per_wiki", 150))
    base_min = int(getattr(settings, "flashcard_section_min_chars", 900))
    base_level = int(getattr(settings, "flashcard_section_max_heading_level", 1))
    target_card = max(800, int(getattr(settings, "flashcard_target_chars_per_card", 1500)))
    desired = _desired_section_count(total_chars, settings=settings)

    if max_per_wiki <= 0:
        cap = 0
    else:
        cap = max_per_wiki

    if total_chars >= large_threshold:
        target = max(900, min(target_card, total_chars // max(1, desired)))
        return FlashcardSplitParams(
            min_chars=min(base_min, target),
            max_heading_level=2,
            max_sections=cap,
            target_chars=target,
            min_sections=desired,
        )

    if total_chars >= 15_000:
        return FlashcardSplitParams(
            min_chars=max(600, min(base_min, total_chars // max(1, desired))),
            max_heading_level=2,
            max_sections=min(cap, max(desired, 24)) if cap else max(desired, 24),
            target_chars=max(900, total_chars // max(1, desired)),
            min_sections=desired,
        )

    if total_chars >= 4000:
        target = max(700, min(target_card, total_chars // max(1, desired)))
        return FlashcardSplitParams(
            min_chars=max(600, min(base_min, total_chars // max(1, desired))),
            max_heading_level=2,
            max_sections=min(cap, max(desired, 24)) if cap else max(desired, 24),
            target_chars=target,
            min_sections=desired,
        )

    return FlashcardSplitParams(
        min_chars=base_min,
        max_heading_level=base_level,
        max_sections=min(cap, max(desired, 12)) if cap else max(desired, 12),
        target_chars=max(900, total_chars // max(1, desired)) if total_chars >= 2000 else 0,
        min_sections=desired,
    )


def _slug_part(s: str) -> str:
    t = s.strip().lower()
    t = re.sub(r"[^\w\u4e00-\u9fff]+", "-", t)
    t = re.sub(r"^-+|-+$", "", t)
    return (t[:48] if t else "") or "sec"


def split_markdown_into_sections(markdown: str) -> list[MarkdownSection]:
    raw = (markdown or "").replace("\r\n", "\n")
    if not raw.strip():
        return [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown="")]

    lines = raw.split("\n")
    chunks: list[list[str]] = []
    fence = False
    cur: list[str] = []

    def flush() -> None:
        nonlocal cur
        if cur:
            chunks.append(cur)
            cur = []

    for line in lines:
        t = line.lstrip()
        if t.startswith("```"):
            fence = not fence
            cur.append(line)
            continue
        if not fence:
            m = _HEADING_RE.match(line)
            if m and len(m.group(1)) <= 6:
                flush()
                cur.append(line)
                continue
        if not cur and not chunks and line.strip() == "":
            continue
        cur.append(line)
    flush()

    if not chunks:
        return [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown=raw.strip())]

    used: set[str] = set()
    out: list[MarkdownSection] = []
    for idx, chunk_lines in enumerate(chunks):
        block = "\n".join(chunk_lines).strip()
        if not block:
            continue
        first = _HEADING_RE.match(chunk_lines[0] or "")
        title = f"片段 {idx + 1}"
        level = 2
        if first:
            level = len(first.group(1))
            title = (first.group(2) or "").strip() or title
        elif idx == 0:
            title = "文首"
            level = 1
        sid = f"wiki-sec-{_slug_part(title)}"
        if sid in used:
            sid = f"{sid}-{idx}"
        used.add(sid)
        out.append(MarkdownSection(id=sid, title=title, level=level, markdown=block))

    return out or [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown=raw.strip())]


def _section_body_chars(markdown: str) -> int:
    lines = (markdown or "").split("\n")
    if lines and _HEADING_RE.match(lines[0] or ""):
        return len("\n".join(lines[1:]).strip())
    return len((markdown or "").strip())


def _infer_chunk_title(markdown: str, index: int) -> str:
    for line in (markdown or "").split("\n")[:6]:
        stripped = line.strip()
        if not stripped:
            continue
        hm = _HEADING_RE.match(stripped)
        if hm:
            return (hm.group(2) or "").strip() or f"片段 {index + 1}"
        if _PLAINTEXT_CHAPTER_RE.match(stripped):
            return stripped[:72]
    return f"片段 {index + 1}"


def _split_plaintext_chapter_lines(markdown: str) -> list[MarkdownSection]:
    """识别 PDF 抽取正文中的「第X章 / Chapter N」行并切分。"""
    raw = (markdown or "").replace("\r\n", "\n").strip()
    if not raw:
        return []

    lines = raw.split("\n")
    chunks: list[list[str]] = []
    cur: list[str] = []
    hits = 0

    for line in lines:
        stripped = line.strip()
        if stripped and _PLAINTEXT_CHAPTER_RE.match(stripped) and cur:
            chunks.append(cur)
            cur = [line]
            hits += 1
            continue
        cur.append(line)
    if cur:
        chunks.append(cur)

    if hits < 2:
        return []

    used: set[str] = set()
    out: list[MarkdownSection] = []
    for idx, chunk_lines in enumerate(chunks):
        block = "\n".join(chunk_lines).strip()
        if not block:
            continue
        title = _infer_chunk_title(block, idx)
        sid = f"wiki-sec-{_slug_part(title)}"
        if sid in used:
            sid = f"{sid}-{idx}"
        used.add(sid)
        out.append(MarkdownSection(id=sid, title=title, level=1, markdown=block))
    return out


def _split_by_paragraph_budget(
    markdown: str,
    *,
    target_chars: int,
    min_chars: int,
) -> list[MarkdownSection]:
    """大段无标题正文：按段落累积字数切分，供教材级 PDF 产出百级闪卡。"""
    raw = (markdown or "").replace("\r\n", "\n").strip()
    if not raw:
        return []

    target = max(800, target_chars)
    floor = max(400, min_chars)
    paras = [p.strip() for p in re.split(r"\n\s*\n+", raw) if p.strip()]
    if len(paras) < 2:
        paras = [raw[i : i + target] for i in range(0, len(raw), target)]

    groups: list[list[str]] = []
    buf: list[str] = []
    buf_len = 0

    for para in paras:
        plen = len(para)
        if buf and buf_len >= floor and buf_len + plen > int(target * 1.25):
            groups.append(buf)
            buf = [para]
            buf_len = plen
        else:
            buf.append(para)
            buf_len += plen
    if buf:
        if groups and buf_len < floor:
            groups[-1].extend(buf)
        else:
            groups.append(buf)

    used: set[str] = set()
    out: list[MarkdownSection] = []
    for idx, group in enumerate(groups):
        block = "\n\n".join(group).strip()
        if len(block) < floor // 2:
            continue
        title = _infer_chunk_title(block, idx)
        sid = f"wiki-sec-{_slug_part(title)}"
        if sid in used:
            sid = f"{sid}-{idx}"
        used.add(sid)
        out.append(MarkdownSection(id=sid, title=title, level=2, markdown=block))
    return out


def _split_at_heading_level(markdown: str, *, max_heading_level: int) -> list[MarkdownSection]:
    """仅在 level <= max_heading_level 的标题处切分（用于闪卡粗粒度分块）。"""
    raw = (markdown or "").replace("\r\n", "\n")
    if not raw.strip():
        return [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown="")]

    lines = raw.split("\n")
    chunks: list[list[str]] = []
    fence = False
    cur: list[str] = []

    def flush() -> None:
        nonlocal cur
        if cur:
            chunks.append(cur)
            cur = []

    for line in lines:
        t = line.lstrip()
        if t.startswith("```"):
            fence = not fence
            cur.append(line)
            continue
        if not fence:
            m = _HEADING_RE.match(line)
            if m and len(m.group(1)) <= max(1, max_heading_level):
                flush()
                cur.append(line)
                continue
        if not cur and not chunks and line.strip() == "":
            continue
        cur.append(line)
    flush()

    if not chunks:
        return [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown=raw.strip())]

    used: set[str] = set()
    out: list[MarkdownSection] = []
    for idx, chunk_lines in enumerate(chunks):
        block = "\n".join(chunk_lines).strip()
        if not block:
            continue
        first = _HEADING_RE.match(chunk_lines[0] or "")
        title = f"片段 {idx + 1}"
        level = 2
        if first:
            level = len(first.group(1))
            title = (first.group(2) or "").strip() or title
        elif idx == 0:
            title = "文首"
            level = 1
        sid = f"wiki-sec-{_slug_part(title)}"
        if sid in used:
            sid = f"{sid}-{idx}"
        used.add(sid)
        out.append(MarkdownSection(id=sid, title=title, level=level, markdown=block))

    return out or [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown=raw.strip())]


def _merge_section_group(group: list[MarkdownSection], *, gi: int) -> MarkdownSection:
    if len(group) == 1:
        return group[0]
    title = group[0].title
    if len(group) > 2:
        title = f"{title}（等 {len(group)} 节）"
    elif len(group) == 2 and group[1].title != title:
        title = f"{title} · {group[1].title}"
    md = "\n\n".join(s.markdown for s in group)
    level = min(s.level for s in group)
    sid = f"wiki-sec-{_slug_part(title)}"
    if gi > 0:
        sid = f"{sid}-blk{gi}"
    return MarkdownSection(id=sid, title=title, level=level, markdown=md)


def _merge_small_sections(sections: list[MarkdownSection], *, min_chars: int) -> list[MarkdownSection]:
    if not sections or min_chars <= 0:
        return sections

    groups: list[list[MarkdownSection]] = []
    buf: list[MarkdownSection] = []
    buf_chars = 0

    for sec in sections:
        buf.append(sec)
        buf_chars += _section_body_chars(sec.markdown)
        if buf_chars >= min_chars:
            groups.append(buf)
            buf = []
            buf_chars = 0
    if buf:
        if groups and buf_chars < min_chars:
            groups[-1].extend(buf)
        else:
            groups.append(buf)

    return [_merge_section_group(group, gi=gi) for gi, group in enumerate(groups)]


def _cap_section_count(sections: list[MarkdownSection], *, max_sections: int) -> list[MarkdownSection]:
    """块数过多时按顺序合并相邻节，控制单篇 wiki 的闪卡数量。"""
    if max_sections <= 0 or len(sections) <= max_sections:
        return sections

    groups: list[list[MarkdownSection]] = []
    i = 0
    while i < len(sections):
        remaining = len(sections) - i
        groups_left = max_sections - len(groups)
        take = (remaining + groups_left - 1) // groups_left
        groups.append(sections[i : i + take])
        i += take
    return [_merge_section_group(g, gi=gi) for gi, g in enumerate(groups)]


def split_sections_for_flashcards(markdown: str, settings=None) -> list[MarkdownSection]:
    """
    闪卡专用分块：按文档长度自适应。
    短笔记少卡；400 页级 PDF 可通过章标题识别 + 按段字数切分产出 100+ 卡。
    """
    from app.config import settings as default_settings  # noqa: PLC0415

    cfg = settings or default_settings
    body = (markdown or "").replace("\r\n", "\n").strip()
    if not body:
        return [MarkdownSection(id="wiki-sec-intro", title="正文", level=1, markdown="")]

    total = len(body)
    params = resolve_flashcard_split_params(total, settings=cfg)
    large_threshold = max(0, int(getattr(cfg, "flashcard_large_doc_chars", 60_000)))

    preliminary = _split_at_heading_level(body, max_heading_level=params.max_heading_level)

    plain = _split_plaintext_chapter_lines(body)
    chapter_preliminary = False
    if len(plain) >= 3 and len(preliminary) <= max(2, len(plain) // 2):
        preliminary = plain
        chapter_preliminary = True
    elif total >= large_threshold and len(plain) >= 3:
        preliminary = plain
        chapter_preliminary = True

    if chapter_preliminary:
        merged = preliminary
    else:
        merged = _merge_small_sections(preliminary, min_chars=params.min_chars)

    if params.target_chars > 0 and len(merged) < params.min_sections and total >= 4000:
        budgeted = _split_by_paragraph_budget(
            body,
            target_chars=params.target_chars,
            min_chars=max(400, params.min_chars),
        )
        if len(budgeted) > len(merged):
            merged = budgeted
    elif params.target_chars > 0 and len(merged) <= 3 and total >= large_threshold:
        budgeted = _split_by_paragraph_budget(
            body,
            target_chars=params.target_chars,
            min_chars=params.min_chars,
        )
        if len(budgeted) > len(merged):
            merged = budgeted

    return _cap_section_count(merged, max_sections=params.max_sections)


def split_coarse_sections_for_flashcards(
    markdown: str,
    *,
    min_chars: int = 1800,
    max_heading_level: int = 1,
    max_sections: int = 0,
) -> list[MarkdownSection]:
    """兼容旧调用：显式参数分块（测试 / 回退）。"""
    preliminary = _split_at_heading_level(markdown, max_heading_level=max_heading_level)
    merged = _merge_small_sections(preliminary, min_chars=max(0, min_chars))
    return _cap_section_count(merged, max_sections=max_sections)


def find_section_by_id(markdown: str, section_id: str) -> MarkdownSection | None:
    """在多种分块结果中查找章节（兼容历史 section_id）。"""
    sid = (section_id or "").strip()
    if not sid:
        return None
    for splitter in (
        split_sections_for_flashcards,
        split_coarse_sections_for_flashcards,
        split_markdown_into_sections,
    ):
        for sec in splitter(markdown):
            if sec.id == sid:
                return sec
    return None
