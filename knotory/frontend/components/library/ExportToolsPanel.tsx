"use client";

import KnotoryDownloadLink from "@/components/KnotoryDownloadLink";
import {
  corpusArchiveUrl,
  flashcardExportMarkdownUrl,
  flashcardNotesExportUrl,
} from "@/lib/api";

/** 云端带走：闪卡 · 笔记 · 整库备份（zip 内已含 manifest） */
const EXPORT_ITEMS = [
  {
    id: "flashcards",
    glyph: "◫",
    title: "闪卡",
    hint: "全部知识点 · Markdown，可读可打印",
    href: flashcardExportMarkdownUrl,
    filename: "knotory-flashcards.md",
  },
  {
    id: "notes",
    glyph: "✎",
    title: "笔记",
    hint: "刷读时写的笔记汇总 · Markdown",
    href: flashcardNotesExportUrl,
    filename: "knotory-flashcard-notes.md",
  },
  {
    id: "archive",
    glyph: "▣",
    title: "文库备份",
    hint: "Wiki、原件、摘要与清单 · zip",
    href: corpusArchiveUrl,
    filename: "knotory-corpus.zip",
  },
] as const;

export default function ExportToolsPanel() {
  return (
    <section className="card card--desk card--export" id="library-export" aria-labelledby="export-tools-title">
      <div className="card__head card__head--compact">
        <div>
          <p className="card__kicker">导出</p>
          <h2 className="card__title" id="export-tools-title">
            从云端带走你的学习资料
          </h2>
          <p className="card__sub">
            三种格式覆盖日常备份：闪卡、笔记，以及含原文与 wiki 的完整文库包。
          </p>
        </div>
      </div>
      <ul className="export-grid export-grid--cloud">
        {EXPORT_ITEMS.map((item) => (
          <li key={item.id} className="export-tile">
            <span className="export-tile__glyph" aria-hidden>
              {item.glyph}
            </span>
            <div className="export-tile__body">
              <h3 className="export-tile__title">{item.title}</h3>
              <p className="export-tile__hint">{item.hint}</p>
            </div>
            <KnotoryDownloadLink href={item.href()} filename={item.filename} className="export-tile__action">
              下载
            </KnotoryDownloadLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
