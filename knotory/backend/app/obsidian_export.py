"""Obsidian 库导出：wiki + 闪卡笔记 + 索引页。"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session, select

from app.corpus_store import ensure_local_path
from app.flashcard_export import export_flashcards_markdown
from app.models import FlashcardUserNote, KnowledgeFlashcard
from app.paths import tenant_data_dir
from app.storage import WIKI_DIR, engine, list_wiki_docs
from app.tenant_queries import flashcard_scope, note_scope


def build_obsidian_vault_zip_bytes() -> bytes:
    root = tenant_data_dir()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in list_wiki_docs():
            name = (doc.get("name") or "").strip()
            if not name or "/" in name:
                continue
            path = ensure_local_path(root / WIKI_DIR / name)
            if path.is_file():
                zf.write(path, f"vault/wiki/{name}")

        with Session(engine) as session:
            cards = list(session.exec(select(KnowledgeFlashcard).where(flashcard_scope()).where(KnowledgeFlashcard.active == True)))  # noqa: E712
            notes = {
                n.flashcard_id: n.text
                for n in session.exec(select(FlashcardUserNote).where(note_scope())).all()
            }

        index_lines = ["# Knotory 闪卡索引", "", f"导出时间：{datetime.now(timezone.utc).isoformat()}", ""]
        for card in cards:
            if card.id is None:
                continue
            slug = f"fc-{card.id}"
            front = (card.front_text or "").replace("\n", " ")
            body = [
                "---",
                f"topic: {card.topic}",
                f"kind: {card.card_kind}",
                f"wiki: {card.wiki_file_name or ''}",
                "---",
                "",
                f"# {front[:120]}",
                "",
                "## 答案",
                "",
                card.back_text or "",
                "",
            ]
            note = (notes.get(card.id) or "").strip()
            if note:
                body.extend(["## 我的笔记", "", note, ""])
            if card.wiki_file_name:
                wiki_stem = Path(card.wiki_file_name).stem
                body.extend([f"来源：[[{wiki_stem}]]", ""])
            zf.writestr(f"vault/flashcards/{slug}.md", "\n".join(body))
            index_lines.append(f"- [[{slug}|{front[:60]}]] · {card.topic}")

        zf.writestr("vault/闪卡索引.md", "\n".join(index_lines) + "\n")
        zf.writestr("vault/README.md", export_flashcards_markdown()[:200_000])
        manifest = {
            "format": "obsidian-vault",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "card_count": len(cards),
            "hint": "将 vault/ 目录复制到 Obsidian 库根目录即可。",
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    buf.seek(0)
    return buf.getvalue()
