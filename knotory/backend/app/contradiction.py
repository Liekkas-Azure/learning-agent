import logging
from dataclasses import dataclass

from app.models import IngestRecord

logger = logging.getLogger("knotory.contradiction")

_NEG = (
    "不",
    "未能",
    "没有",
    "无",
    "否",
    "下降",
    "减少",
    "失败",
    "风险",
    "负面",
    "not ",
    " no ",
    "without",
    "decline",
    "negative",
    "loss",
)
_POS = (
    "增长",
    "成功",
    "提升",
    "增加",
    "改善",
    "盈利",
    "正面",
    "yes",
    "improve",
    "growth",
    "positive",
    "profit",
)


def _polarity(text: str) -> int:
    if not text.strip():
        return 0
    lower = text.lower()
    neg = sum(1 for w in _NEG if w in text or w.lower() in lower)
    pos = sum(1 for w in _POS if w in text or w.lower() in lower)
    if neg > pos + 1:
        return -1
    if pos > neg + 1:
        return 1
    return 0


@dataclass
class ContradictionHit:
    other_id: int
    overlap_tags: list[str]
    note: str


def detect_contradictions(
    tags: list[str],
    summary: str,
    recent: list[IngestRecord],
    *,
    self_id: int | None = None,
) -> list[dict]:
    """Lightweight local check: overlapping tags + opposing polarity keywords."""
    tag_set = {t.strip() for t in tags if t.strip()}
    if not tag_set:
        return []

    mine = _polarity(summary)
    if mine == 0:
        return []

    hits: list[ContradictionHit] = []
    for rec in recent:
        if self_id is not None and rec.id == self_id:
            continue
        other_tags = {t.strip() for t in (rec.tags_csv or "").split(",") if t.strip()}
        overlap = sorted(tag_set & other_tags)
        if not overlap:
            continue
        other_pol = _polarity(rec.summary or "")
        if mine * other_pol < 0:
            hits.append(
                ContradictionHit(
                    other_id=rec.id or -1,
                    overlap_tags=overlap,
                    note="Polarity mismatch on shared tags (heuristic).",
                )
            )

    if hits:
        logger.info("Contradiction candidates: %s", len(hits))
    return [
        {"other_record_id": h.other_id, "overlap_tags": h.overlap_tags, "note": h.note}
        for h in hits[:8]
    ]
