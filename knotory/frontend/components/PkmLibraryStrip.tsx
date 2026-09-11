"use client";

import KnotoryDownloadLink from "@/components/KnotoryDownloadLink";
import { corpusArchiveUrl, corpusManifestUrl } from "@/lib/api";

/** 文库备份：可迁移结构与整库导出入口 */
export default function PkmLibraryStrip() {
  return (
    <section className="pkm-library card card--desk" id="pkm-portable" aria-labelledby="pkm-portable-title">
      <div className="card__head">
        <div>
          <p className="card__kicker">文库备份</p>
          <h2 className="card__title" id="pkm-portable-title">
            带走你的文库与闪卡
          </h2>
          <p className="card__sub">
            所有内容来自你上传的材料，落在标准目录中；可整包下载备份，或用 Obsidian 打开{" "}
            <code className="inline-code">wiki/</code>。
          </p>
        </div>
        </div>
      <ul className="pkm-library__tree">
        <li>
          <code className="inline-code">wiki/*.md</code> — 带 <code className="inline-code">[[双向链接]]</code> 的 Markdown
        </li>
        <li>
          <code className="inline-code">raw/*.txt</code> — 抽取正文；<code className="inline-code">*.ai.txt</code> — AI 稿；{" "}
          <code className="inline-code">*.ai.meta.json</code> — 重排审计
        </li>
        <li>
          <code className="inline-code">outputs/*.json</code> — 摘要与标签
        </li>
      </ul>
      <div className="pkm-library__actions">
        <KnotoryDownloadLink
          className="btn btn-secondary"
          href={corpusManifestUrl()}
          filename="knotory-manifest.json"
        >
          下载 manifest.json
        </KnotoryDownloadLink>
        <KnotoryDownloadLink className="btn btn-primary" href={corpusArchiveUrl()} filename="knotory-corpus.zip">
          打包下载文库 (.zip)
        </KnotoryDownloadLink>
      </div>
      <p className="pkm-library__note">
        单篇可在阅读区导出 wiki / 抽取 / AI 稿。索引库在 SQLite 中，整库迁移时请同时备份{" "}
        <code className="inline-code">KNOTORY_DB_PATH</code>。
      </p>
    </section>
  );
}
