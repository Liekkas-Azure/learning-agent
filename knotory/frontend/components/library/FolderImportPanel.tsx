"use client";

import { useCallback, useRef, useState } from "react";
import { uploadFilesBatch, type BatchUploadProgress } from "@/lib/api";
import { dismissDemoAfterCorpusUpload } from "@/lib/productPrefs";

const ALLOWED_EXT = new Set([
  ".txt",
  ".md",
  ".py",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".docx",
  ".pptx",
]);

function filterUploadableFiles(files: FileList | File[]): File[] {
  return Array.from(files)
    .filter((f) => {
      if (!f.name || f.name.startsWith(".")) return false;
      const dot = f.name.lastIndexOf(".");
      if (dot < 0) return false;
      return ALLOWED_EXT.has(f.name.slice(dot).toLowerCase());
    })
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
}

type Props = {
  onImported?: () => void | Promise<void>;
};

export default function FolderImportPanel({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchUploadProgress | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pickFolder = useCallback(() => {
    if (!busy) inputRef.current?.click();
  }, [busy]);

  const onFolderSelected = useCallback(
    async (list: FileList | null) => {
      const files = filterUploadableFiles(list ?? []);
      if (files.length === 0) {
        setErr("文件夹内没有可导入的文件（支持 PDF、Markdown、图片、代码等）。");
        return;
      }
      setBusy(true);
      setErr(null);
      setMsg(null);
      setProgress({ current: 0, total: files.length, fileName: "", phase: "准备导入…" });
      try {
        const result = await uploadFilesBatch(files, setProgress);
        const failN = result.failed.length;
        if (failN === 0) {
          setMsg(`已导入 ${result.ok} 个文件。`);
        } else {
          setMsg(`成功 ${result.ok} 个，失败 ${failN} 个。`);
          setErr(result.failed.slice(0, 3).map((f) => `${f.file}: ${f.error}`).join("；"));
        }
        if (result.ok > 0) dismissDemoAfterCorpusUpload();
        await onImported?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "批量导入失败");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [onImported],
  );

  return (
    <section className="card card--desk card--folder-import" id="library-folder">
      <div className="card__head card__head--compact">
        <div>
          <p className="card__kicker">批量</p>
          <h2 className="card__title">导入文件夹</h2>
        </div>
      </div>
      <div
        className={`upload-drop upload-drop--folder${busy ? " upload-drop--busy" : ""}`}
        onClick={pickFolder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pickFolder();
          }
        }}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-busy={busy}
      >
        <input
          ref={inputRef}
          type="file"
          className="upload-drop__input"
          // @ts-expect-error webkitdirectory is supported in Chromium / Safari
          webkitdirectory=""
          directory=""
          multiple
          disabled={busy}
          onChange={(e) => {
            void onFolderSelected(e.target.files);
            e.target.value = "";
          }}
          tabIndex={-1}
          aria-hidden
        />
        {busy && progress ? (
          <div className="upload-drop__progress" role="status" aria-live="polite">
            <p className="upload-drop__title">{progress.phase}</p>
            {progress.fileName ? <p className="upload-drop__sub">{progress.fileName}</p> : null}
            <div
              className="upload-progress__track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.current}
            >
              <div
                className="upload-progress__fill"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="upload-drop__title">选择文件夹，批量入库</p>
            <p className="upload-drop__sub">子目录中的 PDF、Markdown、图片、代码等，入库后进入推荐流</p>
          </>
        )}
      </div>
      {msg ? <p className="folder-import__msg">{msg}</p> : null}
      {err ? (
        <p className="upload-error" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
