"""
上传 PDF/长文档在送入大模型前的正文清洗与采样（非「从关键词生成标签」，仅降噪与截断策略）。
"""

from __future__ import annotations

import re
from collections import Counter

# 行级整行删除或强裁剪（营销、页眉页脚常见噪声）
_NOISE_LINE_RES = [
    re.compile(r"^.*扫码\s*关注.*公众号.*$", re.I),
    re.compile(r"^.*关注\s*公众号.*(下载|资料).*$", re.I),
    re.compile(r"^.*免费\s*下载\s*资料.*$", re.I),
    re.compile(r"^.*仅供\s*学习.*$", re.I),
    re.compile(r"^.*如有侵权.*$", re.I),
    re.compile(r"^.{0,6}目录\s*$"),
    re.compile(r"^\s*contents\s*$", re.I),
]

# 行内删除（保留同行的其它文字）
_INLINE_STRIP_RES = [
    re.compile(r"页码[：:]\s*\d+(?:\s*[/／]\s*\d+)?"),
    re.compile(r"第\s*\d+\s*页\s*(?:[/／]\s*\d+\s*页)?"),
]

# 目录行末「………3」类导引
_TOC_TRAILER_RE = re.compile(r"[\s.\u00b7\u2022\u2026\u3002]{2,}\d{1,4}\s*$")

# 标签黑名单：模型若仍输出则剔除（小写比对 + 中文子串）
_TAG_SUBSTRING_BLOCKLIST = (
    "公众号",
    "扫码",
    "免费下载",
    "页码",
    "关注公众号",
    "下载资料",
    "仅供学习",
    "如有侵权",
    "目录页",
    "网盘",
    "加微信",
    "客服",
)


def _strip_toc_dot_trailer(line: str) -> str:
    s = line.rstrip()
    s = _TOC_TRAILER_RE.sub("", s)
    return s.rstrip()


def _is_noise_line(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 200:
        return False
    for rx in _NOISE_LINE_RES:
        if rx.search(s):
            return True
    # 整行几乎只有点与数字
    if re.fullmatch(r"[\s.\u00b7\u2022\u2026\u3000\d]{3,}", s):
        return True
    return False


def _clean_line(line: str) -> str:
    s = line
    for rx in _INLINE_STRIP_RES:
        s = rx.sub(" ", s)
    s = _strip_toc_dot_trailer(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def dedupe_frequent_short_lines(text: str, *, min_count: int = 5, max_line_len: int = 120, keep_first: int = 2) -> str:
    """整篇重复出现的短行（页眉/水印）只保留前若干次。"""
    lines = text.splitlines()
    stripped = [ln.strip() for ln in lines]
    counts: Counter[str] = Counter(s for s in stripped if s and len(s) <= max_line_len)
    noisy = {s for s, c in counts.items() if c >= min_count}
    seen: dict[str, int] = {}
    out: list[str] = []
    for ln in lines:
        key = ln.strip()
        if key in noisy:
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > keep_first:
                continue
        out.append(ln)
    return "\n".join(out)


def collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{4,}", "\n\n\n", text).strip()


def prepare_for_llm(text: str) -> str:
    """去营销话术/页码碎片/目录点线，并压重复短行。"""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned_lines: list[str] = []
    for line in raw.split("\n"):
        if _is_noise_line(line):
            continue
        cl = _clean_line(line)
        if cl:
            cleaned_lines.append(cl)
    body = "\n".join(cleaned_lines)
    body = dedupe_frequent_short_lines(body)
    body = collapse_blank_lines(body)
    return body


def stratified_excerpt(text: str, max_chars: int = 24_000) -> str:
    """长文档取头/中/尾三段，减轻「前几页全是目录与广告」对标签的绑架。"""
    t = text.strip()
    if len(t) <= max_chars:
        return t
    part = max_chars // 3
    head = t[:part]
    mid_start = max(0, len(t) // 2 - part // 2)
    mid = t[mid_start : mid_start + part]
    tail = t[-part:]
    return (
        f"{head}\n\n"
        f"…[中段采样：原文共约 {len(t)} 字，已省略中间与版式重复部分]…\n\n"
        f"{mid}\n\n"
        f"…[后段采样]…\n\n"
        f"{tail}"
    )


def prepare_long_document_for_extraction(text: str, *, max_chars: int = 24_000) -> str:
    cleaned = prepare_for_llm(text)
    return stratified_excerpt(cleaned, max_chars=max_chars)


def is_noise_tag(label: str) -> bool:
    s = (label or "").strip()
    if not s:
        return True
    low = s.casefold()
    for frag in _TAG_SUBSTRING_BLOCKLIST:
        if frag in s or frag.casefold() in low:
            return True
    if re.fullmatch(r"\d{1,4}", s):
        return True
    if len(s) > 200:
        return True
    return False


def filter_noise_tags(tags: list[str]) -> list[str]:
    """去重与黑名单过滤，不再限制条数，便于 wiki 签条与全文展示。"""
    out: list[str] = []
    seen: set[str] = set()
    for t in tags:
        s = str(t).strip()
        if not s or is_noise_tag(s):
            continue
        key = s.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out
