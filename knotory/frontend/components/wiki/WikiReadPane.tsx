"use client";

import KnotoryDownloadLink from "@/components/KnotoryDownloadLink";
import TextSelectionCopyHost from "@/components/wiki/TextSelectionCopyHost";
import WikiAiResultReading, { type WikiRelatedItem } from "@/components/wiki/WikiAiResultReading";
import WikiOriginalViewer from "@/components/wiki/WikiOriginalViewer";
import WikiCompareColumns from "@/components/wiki/WikiCompareColumns";
import {
  wikiExportFileUrl,
  type AiFormatMeta,
  type ReadingCorpusSnippet,
  type WikiReadingTab,
} from "@/lib/api";

function formatAuditLine(meta: AiFormatMeta): string {
  const raw = meta.updated_at;
  const d = raw ? new Date(raw) : null;
  const when =
    d && !Number.isNaN(d.getTime()) ? d.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" }) : "—";
  const prov = meta.provider?.trim() || "—";
  return `重排于 ${when} · ${prov}`;
}

export type WikiReadPaneProps = {
  wikiFileName: string | null;
  docTitle: string;
  wikiLoading: boolean;
  wikiExtracted: string | null;
  wikiFormattedExtracted: string | null;
  readingTab: WikiReadingTab;
  onReadingTab: (tab: WikiReadingTab) => void;
  originalFilename: string | null;
  originalBytesAvailable: boolean;
  formatExtractBusy: boolean;
  onFormatExtractedBody: () => void | Promise<void>;
  related: WikiRelatedItem[];
  corpusSnippets: ReadingCorpusSnippet[];
  onOpenWiki: (wikiMdName: string) => void;
  /** 将关联篇在右栏对照打开；未提供时不显示「右栏」按钮 */
  onOpenWikiInSecondary?: (wikiMdName: string) => void;
  /** 与 raw/*.ai.meta.json 对应，便于展示「可审计重跑」 */
  aiFormatMeta?: AiFormatMeta | null;
};

export default function WikiReadPane({
  wikiFileName,
  docTitle,
  wikiLoading,
  wikiExtracted,
  wikiFormattedExtracted,
  readingTab,
  onReadingTab,
  originalFilename,
  originalBytesAvailable,
  formatExtractBusy,
  onFormatExtractedBody,
  related,
  corpusSnippets,
  onOpenWiki,
  onOpenWikiInSecondary,
  aiFormatMeta,
}: WikiReadPaneProps) {
  const readingMarkdown = readingTab === "ai" ? wikiFormattedExtracted ?? "" : wikiExtracted ?? "";
  const clipLabel = docTitle || wikiFileName || "";
  const showPortable = Boolean(wikiFileName && (wikiExtracted || originalBytesAvailable));
  const showAudit = Boolean(wikiFormattedExtracted?.trim());
  const canCompare = Boolean(wikiExtracted?.trim() && wikiFormattedExtracted?.trim());
  const auditText =
    showAudit && aiFormatMeta
      ? formatAuditLine(aiFormatMeta)
      : showAudit
        ? "尚无审计记录，重排后将保存模型与时间。"
        : null;

  return (
    <>
      {!wikiLoading && wikiFileName && (wikiExtracted || originalBytesAvailable) ? (
        <>
          <div className="wiki-reading-panel__toolbar wiki-read-toolbar">
            <div className="wiki-read-tabs" role="tablist" aria-label="阅读视图">
              <button
                type="button"
                role="tab"
                aria-selected={readingTab === "original"}
                className={`wiki-extract-tab${readingTab === "original" ? " wiki-extract-tab--active" : ""}`}
                onClick={() => onReadingTab("original")}
              >
                原稿
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readingTab === "ai"}
                className={`wiki-extract-tab${readingTab === "ai" ? " wiki-extract-tab--active" : ""}`}
                onClick={() => onReadingTab("ai")}
              >
                AI 稿
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readingTab === "compare"}
                className={`wiki-extract-tab${readingTab === "compare" ? " wiki-extract-tab--active" : ""}`}
                disabled={!canCompare}
                title={canCompare ? "左右对照抽取与 AI 稿" : "需同时有抽取正文与 AI 稿"}
                onClick={() => onReadingTab("compare")}
              >
                对照
              </button>
              <button
                type="button"
                className="btn btn-secondary wiki-extract-format-btn wiki-read-tabs__action"
                disabled={formatExtractBusy || !wikiExtracted}
                onClick={() => void onFormatExtractedBody()}
              >
                {formatExtractBusy ? "排版中…" : "重排 AI 稿"}
              </button>
            </div>
          </div>
          {showPortable ? (
            <div className="wiki-reading-panel__subbar wiki-read-subbar">
              {auditText ? (
                <p className="wiki-reading-panel__audit" role="status">
                  {auditText}
                </p>
              ) : (
                <span className="wiki-read-subbar__spacer" aria-hidden />
              )}
              <div className="wiki-read-exports" role="group" aria-label="导出">
                <KnotoryDownloadLink
                  className="wiki-read-export"
                  href={wikiExportFileUrl(wikiFileName!, "wiki")}
                  filename={`${wikiFileName}.md`}
                >
                  wiki
                </KnotoryDownloadLink>
                {wikiExtracted?.trim() ? (
                  <KnotoryDownloadLink
                    className="wiki-read-export"
                    href={wikiExportFileUrl(wikiFileName!, "extracted")}
                    filename={`${wikiFileName}.extracted.txt`}
                  >
                    抽取
                  </KnotoryDownloadLink>
                ) : null}
                {wikiFormattedExtracted?.trim() ? (
                  <KnotoryDownloadLink
                    className="wiki-read-export"
                    href={wikiExportFileUrl(wikiFileName!, "ai")}
                    filename={`${wikiFileName}.ai.txt`}
                  >
                    AI 稿
                  </KnotoryDownloadLink>
                ) : null}
                {aiFormatMeta ? (
                  <KnotoryDownloadLink
                    className="wiki-read-export"
                    href={wikiExportFileUrl(wikiFileName!, "ai_meta")}
                    filename={`${wikiFileName}.ai.meta.json`}
                  >
                    审计
                  </KnotoryDownloadLink>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div
        className="wiki-preview wiki-preview--rendered wiki-reading-panel__scroller"
        role="article"
        aria-label={wikiFileName ? `阅读：${wikiFileName}` : "阅读正文"}
        aria-busy={wikiLoading || formatExtractBusy}
      >
        {wikiLoading ? (
          <p className="wiki-preview-placeholder">加载中…</p>
        ) : !wikiFileName ? (
          <p className="wiki-preview-placeholder">请先在左侧选一篇。</p>
        ) : (
          <TextSelectionCopyHost docLabel={clipLabel}>
            <div className="wiki-body-dual">
              {wikiFileName && (wikiExtracted || originalBytesAvailable) ? (
                <section className="wiki-full-source wiki-full-source--scroll-body" aria-label="阅读正文">
                  {readingTab === "compare" && canCompare ? (
                    <WikiCompareColumns
                      extractedText={wikiExtracted ?? ""}
                      aiFormattedText={wikiFormattedExtracted ?? ""}
                    />
                  ) : readingTab === "original" && wikiFileName ? (
                    <WikiOriginalViewer
                      wikiFileName={wikiFileName}
                      originalFilename={originalFilename}
                      originalBytesAvailable={originalBytesAvailable}
                      extractedText={wikiExtracted ?? ""}
                    />
                  ) : readingTab === "ai" && !wikiFormattedExtracted ? (
                    <div className="wiki-reading-ai-placeholder">
                      <p className="wiki-preview-placeholder" style={{ marginBottom: 0 }}>
                        暂无 AI 稿，点「重排 AI 稿」生成。
                      </p>
                    </div>
                  ) : (
                    <WikiAiResultReading
                      markdown={readingMarkdown}
                      related={related}
                      wikiFileName={wikiFileName}
                      docTitle={docTitle}
                      corpusSnippets={corpusSnippets}
                      extractedRawText={wikiExtracted}
                      onOpenWiki={onOpenWiki}
                      onOpenWikiInSecondary={onOpenWikiInSecondary}
                    />
                  )}
                </section>
              ) : (
                <p className="wiki-preview-placeholder" style={{ marginBottom: 0 }}>
                  找不到正文，请换一篇或重新导入。
                </p>
              )}
            </div>
          </TextSelectionCopyHost>
        )}
      </div>
    </>
  );
}
