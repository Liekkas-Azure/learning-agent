"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { chatRag, factCheck, listRecords, type RagSource } from "@/lib/api";

export default function ChatPage() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<RagSource[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [factLoading, setFactLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factClaim, setFactClaim] = useState("");
  const [factResult, setFactResult] = useState<string | null>(null);
  const [corpusReady, setCorpusReady] = useState<boolean | null>(null);

  useEffect(() => {
    void listRecords(5)
      .then((rows) => setCorpusReady(rows.length > 0))
      .catch(() => setCorpusReady(false));
  }, []);

  const ask = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setAskLoading(true);
    setError(null);
    try {
      const res = await chatRag(q);
      setAnswer(res.answer);
      setSources(res.sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "问答失败");
    } finally {
      setAskLoading(false);
    }
  };

  const check = async () => {
    const c = factClaim.trim();
    if (c.length < 6) return;
    setFactLoading(true);
    setError(null);
    try {
      const res = await factCheck(c);
      setFactResult(`${res.verdict}（置信 ${Math.round(res.confidence * 100)}%）：${res.summary}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "检验失败");
    } finally {
      setFactLoading(false);
    }
  };

  const showEmpty = corpusReady === false;

  return (
    <main className="page chat-page">
      <header className="page-head chat-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">辅助功能</p>
          <h1 className="page-head__title chat-page__title">文库问答</h1>
          <p className="page-head__sub chat-page__sub">
            基于你上传的内容检索作答 · 主路径仍是推荐流刷知识点
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/library" className="btn btn-secondary btn-sm">
            去文库
          </Link>
        </div>
      </header>

      {showEmpty ? (
        <div className="chat-page__empty feed-center" style={{ minHeight: "auto", padding: "24px 0" }}>
          <p className="feed-center__title">文库还是空的</p>
          <p className="feed-center__text">上传材料后，才能就你的内容提问与核验陈述。</p>
          <Link href="/library" className="btn btn-primary">
            去文库上传
          </Link>
        </div>
      ) : null}

      <section className="chat-page__panel">
        <textarea
          className="chat-page__input"
          rows={4}
          placeholder="就文库内容提问…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={showEmpty}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={askLoading || showEmpty}
          onClick={() => void ask()}
        >
          {askLoading ? "思考中…" : "提问"}
        </button>
        {error ? <p className="feed-center__text feed-center__text--err">{error}</p> : null}
        {answer ? (
          <div className="chat-page__answer">
            <h2>回答</h2>
            <p>{answer}</p>
          </div>
        ) : null}
        {sources.length ? (
          <div className="chat-page__sources">
            <h3>引用</h3>
            <ul>
              {sources.map((s) => (
                <li key={s.index}>
                  [{s.index}] {s.title}
                  {s.wiki_file_name ? (
                    <>
                      {" "}
                      <Link href={`/library?wiki=${encodeURIComponent(s.wiki_file_name)}`}>查看出处</Link>
                    </>
                  ) : null}
                  <p className="chat-page__snippet">{s.snippet}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="chat-page__panel chat-page__panel--fact">
        <h2 className="chat-page__section-title">事实核验</h2>
        <p className="chat-page__panel-desc">对照文库片段，判断一句陈述是否有依据。</p>
        <textarea
          className="chat-page__input"
          rows={3}
          placeholder="输入一句待检验的陈述…"
          value={factClaim}
          onChange={(e) => setFactClaim(e.target.value)}
          disabled={showEmpty}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={factLoading || showEmpty}
          onClick={() => void check()}
        >
          {factLoading ? "检验中…" : "检验"}
        </button>
        {factResult ? <p className="chat-page__fact-result">{factResult}</p> : null}
      </section>
    </main>
  );
}
