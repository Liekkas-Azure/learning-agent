"use client";

export type LibraryTab = "upload" | "read" | "advanced";

type Props = {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  wikiCount: number;
  recordCount: number;
};

const tabs: { id: LibraryTab; label: string; hint: string }[] = [
  { id: "upload", label: "上传拆卡", hint: "导入 · 导出 · 搞懂清单" },
  { id: "read", label: "深读", hint: "原稿与 AI 稿" },
  { id: "advanced", label: "高级", hint: "批量 · 关联 · 记录" },
];

export default function LibraryTabNav({ tab, onTabChange, wikiCount, recordCount }: Props) {
  return (
    <nav className="library-tabs" aria-label="文库分区">
      {tabs.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          className={`library-tabs__btn${tab === id ? " library-tabs__btn--active" : ""}`}
          onClick={() => onTabChange(id)}
          aria-current={tab === id ? "page" : undefined}
        >
          <span className="library-tabs__label">{label}</span>
          <span className="library-tabs__hint">{hint}</span>
          {id === "upload" && recordCount > 0 ? (
            <span className="library-tabs__badge">{recordCount}</span>
          ) : null}
          {id === "read" && wikiCount > 0 ? (
            <span className="library-tabs__badge">{wikiCount}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
