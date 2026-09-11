"use client";

import { useCallback, useRef, useState } from "react";
import type { UploadProgress } from "@/lib/api";

const ACCEPT =
  ".txt,.md,.py,.json,.js,.ts,.tsx,.java,.go,.rs,.c,.cpp,.pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx";

type Props = {
  uploading: boolean;
  progress: UploadProgress | null;
  onFile: (file: File) => void;
};

export default function SimpleUploadZone({ uploading, progress, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = useCallback(() => {
    if (!uploading) inputRef.current?.click();
  }, [uploading]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f && !uploading) onFile(f);
    },
    [uploading, onFile],
  );

  return (
    <div
      className={`upload-drop${dragOver ? " upload-drop--over" : ""}${uploading ? " upload-drop--busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      role="button"
      tabIndex={uploading ? -1 : 0}
      aria-busy={uploading}
      aria-disabled={uploading}
    >
      <input
        ref={inputRef}
        type="file"
        className="upload-drop__input"
        accept={ACCEPT}
        disabled={uploading}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
        tabIndex={-1}
        aria-hidden
      />
      {uploading && progress ? (
        <div className="upload-drop__progress" role="status" aria-live="polite">
          <p className="upload-drop__title">{progress.phase}</p>
          <div
            className="upload-progress__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.percent)}
          >
            <div className="upload-progress__fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      ) : (
        <>
          <p className="upload-drop__title">拖入文件，或点击上传</p>
          <p className="upload-drop__sub">入库后自动拆成知识点闪卡 · 支持 PDF、Markdown、图片、代码等</p>
        </>
      )}
    </div>
  );
}
