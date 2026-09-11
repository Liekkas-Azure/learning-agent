"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { VaultEntryDto } from "./types";

function kindLabel(k: VaultEntryDto["kind"]) {
  if (k === "link") return "链接";
  if (k === "clip") return "摘录";
  return "笔记";
}

export function VaultEntryDetail({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [entry, setEntry] = useState<VaultEntryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    url: "",
    body: "",
    origin: "",
    tags: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vault/entries/${entryId}`);
      if (!res.ok) {
        setEntry(null);
        return;
      }
      const data = (await res.json()) as { entry: VaultEntryDto };
      setEntry(data.entry);
      setForm({
        title: data.entry.title,
        url: data.entry.url ?? "",
        body: data.entry.body ?? "",
        origin: data.entry.origin ?? "",
        tags: data.entry.tags.map((t) => t.name).join("，"),
      });
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) return;
    setSaving(true);
    try {
      const tagList = form.tags
        .split(/[,，、\n]/g)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/vault/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          url: form.url.trim() || null,
          body: form.body.trim() || null,
          origin: form.origin.trim() || null,
          tags: tagList,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "保存失败");
        return;
      }
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm("确定删除这条知识？此操作不可恢复。")) return;
    const res = await fetch(`/api/vault/entries/${entry.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("删除失败");
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-12 text-center text-sm text-slate-500">
        加载中…
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">未找到该条目。</p>
        <Link href="/" className="ai-link text-sm font-medium">
          返回知识库 →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 sm:pb-8">
      <div>
        <Link href="/" className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 知识库
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/[0.08] bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                {kindLabel(entry.kind)}
              </span>
              {entry.origin ? (
                <span className="rounded-md border border-cyan-500/15 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100/90">
                  {entry.origin}
                </span>
              ) : null}
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{entry.title}</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="ai-btn-ghost rounded-xl border border-white/[0.08] px-3 py-2 text-xs sm:text-sm"
            >
              {editing ? "取消" : "编辑"}
            </button>
            <button
              type="button"
              onClick={() => void onDelete()}
              className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90 sm:text-sm"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      {editing ? (
        <form onSubmit={onSave} className="ai-card space-y-4 p-4 sm:p-5">
          <div>
            <label className="ai-section-label mb-1.5 block">标题</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm outline-none ring-cyan-500/25 focus:ring-2"
            />
          </div>
          {entry.kind === "link" ? (
            <div>
              <label className="ai-section-label mb-1.5 block">URL</label>
              <input
                required
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 font-mono text-xs outline-none ring-cyan-500/25 focus:ring-2"
              />
            </div>
          ) : null}
          <div>
            <label className="ai-section-label mb-1.5 block">正文 / 摘录</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={6}
              className="ai-input w-full resize-none rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm outline-none ring-cyan-500/25 focus:ring-2"
            />
          </div>
          <div>
            <label className="ai-section-label mb-1.5 block">来源</label>
            <input
              value={form.origin}
              onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))}
              className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-500/25 focus:ring-2"
            />
          </div>
          <div>
            <label className="ai-section-label mb-1.5 block">标签</label>
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-500/25 focus:ring-2"
              placeholder="逗号或顿号分隔"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="ai-btn-primary w-full py-2.5 text-sm disabled:opacity-60"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {entry.url ? (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="block break-all rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm font-mono text-cyan-200/90 underline-offset-4 hover:underline"
            >
              {entry.url}
            </a>
          ) : null}
          {entry.body ? (
            <div className="ai-card whitespace-pre-wrap p-4 text-sm leading-relaxed text-slate-300 sm:p-5">
              {entry.body}
            </div>
          ) : (
            <p className="text-sm text-slate-600">暂无正文。</p>
          )}
          {entry.tags.length ? (
            <div className="flex flex-wrap gap-2">
              {entry.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                >
                  {t.name}
                </span>
              ))}
            </div>
          ) : null}
          <p className="font-mono text-[10px] text-slate-600">
            更新于 {new Date(entry.updatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
