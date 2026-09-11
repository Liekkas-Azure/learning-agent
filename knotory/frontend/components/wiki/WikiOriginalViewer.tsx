"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiUsesAuth, knotoryFetch, wikiOriginalFileUrl } from "@/lib/api";
import KnotoryDownloadLink from "@/components/KnotoryDownloadLink";
import WikiReadingMarkdown from "@/components/wiki/WikiReadingMarkdown";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);
const TEXT_EXT = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "json",
  "csv",
  "log",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "yaml",
  "yml",
  "toml",
  "ini",
  "sh",
  "bash",
  "zsh",
  "sql",
]);

function fileExt(filename: string | null): string {
  if (!filename) return "";
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

async function requestFullscreenEl(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => void;
    mozRequestFullScreen?: () => void;
  };
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (anyEl.webkitRequestFullscreen) {
    anyEl.webkitRequestFullscreen();
    return;
  }
  if (anyEl.mozRequestFullScreen) {
    anyEl.mozRequestFullScreen();
  }
}

function getFullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function exitFullscreenDoc(): Promise<void> {
  const doc = document as Document & {
    webkitExitFullscreen?: () => void;
    mozCancelFullScreen?: () => void;
  };
  if (!getFullscreenElement()) return;
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (doc.webkitExitFullscreen) {
    doc.webkitExitFullscreen();
    return;
  }
  if (doc.mozCancelFullScreen) {
    doc.mozCancelFullScreen();
  }
}

function OriginalFullscreenFrame({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const el = rootRef.current;
      setIsFs(Boolean(el && getFullscreenElement() === el));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (getFullscreenElement() === el) {
        await exitFullscreenDoc();
      } else {
        await requestFullscreenEl(el);
      }
    } catch {
      /* 或拒全屏，或非由用户手势触发 */
    }
  }, []);

  return (
    <div ref={rootRef} className="wiki-original-shell">
      <div className="wiki-original-shell__bar">
        <button type="button" className="btn btn-secondary wiki-original-fs-btn" onClick={() => void toggle()} aria-pressed={isFs}>
          {isFs ? "退出全屏" : "全屏"}
        </button>
      </div>
      <div className="wiki-original-shell__body">{children}</div>
    </div>
  );
}

function useAuthenticatedMediaUrl(url: string): { mediaUrl: string | null; err: string | null } {
  const [mediaUrl, setMediaUrl] = useState<string | null>(apiUsesAuth() ? null : url);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!apiUsesAuth()) {
      setMediaUrl(url);
      setErr(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setMediaUrl(null);
    setErr(null);
    void (async () => {
      try {
        const res = await knotoryFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setMediaUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "加载失败");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { mediaUrl, err };
}

function WikiOriginalAsText({ url }: { url: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setErr(null);
    void (async () => {
      try {
        const res = await knotoryFetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const t = await res.text();
        if (!cancelled) setBody(t);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (err) {
    return <p className="wiki-preview-placeholder">无法加载原稿文本：{err}</p>;
  }
  if (body === null) {
    return <p className="wiki-preview-placeholder">正在加载原稿文本…</p>;
  }
  return <WikiReadingMarkdown markdown={body} className="wiki-reading-surface" />;
}

function WikiOriginalBinaryPreview({
  url,
  ext,
  originalFilename,
}: {
  url: string;
  ext: string;
  originalFilename: string | null;
}) {
  const { mediaUrl, err } = useAuthenticatedMediaUrl(url);
  if (err) {
    return <p className="wiki-preview-placeholder">无法加载原稿：{err}</p>;
  }
  if (!mediaUrl) {
    return <p className="wiki-preview-placeholder">正在加载原稿…</p>;
  }
  if (ext === "pdf") {
    return (
      <iframe
        title={originalFilename ? `原稿：${originalFilename}` : "原稿 PDF"}
        src={mediaUrl}
        className="wiki-original-frame"
      />
    );
  }
  if (IMAGE_EXT.has(ext)) {
    return (
      <div className="wiki-original-img-wrap">
        <img src={mediaUrl} alt={originalFilename ?? "原稿图片"} className="wiki-original-img" loading="lazy" />
      </div>
    );
  }
  return null;
}

export type WikiOriginalViewerProps = {
  wikiFileName: string;
  originalFilename: string | null;
  originalBytesAvailable: boolean;
  extractedText: string;
};

export default function WikiOriginalViewer({
  wikiFileName,
  originalFilename,
  originalBytesAvailable,
  extractedText,
}: WikiOriginalViewerProps) {
  const url = useMemo(() => wikiOriginalFileUrl(wikiFileName), [wikiFileName]);
  const ext = useMemo(() => fileExt(originalFilename), [originalFilename]);

  if (originalBytesAvailable) {
    if (ext === "pdf" || IMAGE_EXT.has(ext)) {
      return (
        <OriginalFullscreenFrame>
          <WikiOriginalBinaryPreview url={url} ext={ext} originalFilename={originalFilename} />
        </OriginalFullscreenFrame>
      );
    }
    if (TEXT_EXT.has(ext)) {
      return (
        <OriginalFullscreenFrame>
          <WikiOriginalAsText url={url} />
        </OriginalFullscreenFrame>
      );
    }
    return (
      <OriginalFullscreenFrame>
        <div className="wiki-original-fallback">
          <p className="wiki-preview-placeholder" style={{ marginBottom: 12 }}>
            无法在网页里直接预览该格式（{originalFilename ?? "扩展名未知"}）。请下载后用本机应用打开。
          </p>
          <KnotoryDownloadLink
            className="btn btn-secondary"
            href={url}
            filename={originalFilename || "original"}
          >
            下载原文件
          </KnotoryDownloadLink>
          {extractedText.trim() ? (
            <>
              <p className="wiki-full-source__label wiki-full-source__label--inline" style={{ marginTop: 20 }}>
                抽取出的文本（便于阅读，不是原始二进制文件）
              </p>
              <WikiReadingMarkdown markdown={extractedText} className="wiki-reading-surface" />
            </>
          ) : null}
        </div>
      </OriginalFullscreenFrame>
    );
  }

  if (extractedText.trim()) {
    return (
      <OriginalFullscreenFrame>
        <div className="wiki-original-fallback">
          <p className="wiki-preview-placeholder" style={{ marginBottom: 12 }}>
            找不到原始上传文件（raw/*.source），可能是旧数据。下面只有抽取出的文本。
          </p>
          <WikiReadingMarkdown markdown={extractedText} className="wiki-reading-surface" />
        </div>
      </OriginalFullscreenFrame>
    );
  }

  return <p className="wiki-preview-placeholder">没有原文件，也没有抽取文本。</p>;
}
