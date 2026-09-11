"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchExamFlashcards, listWiki, submitSrsReview, type KnowledgeFlashcard } from "@/lib/api";
import FlashcardAnswerMarkdown from "@/components/feed/FlashcardAnswerMarkdown";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";

export default function ExamPageClient() {
  const searchParams = useSearchParams();
  const [wikis, setWikis] = useState<Array<{ name: string }>>([]);
  const [wiki, setWiki] = useState("");
  const [cards, setCards] = useState<KnowledgeFlashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ know: 0, total: 0 });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);

  useEffect(() => {
    void listWiki().then((docs) => setWikis(docs));
  }, []);

  useEffect(() => {
    const pre = searchParams.get("wiki");
    if (pre) setWiki(pre);
  }, [searchParams]);

  const start = useCallback(async () => {
    if (!wiki) return;
    setStarting(true);
    setStartError(null);
    setEmptyHint(null);
    try {
      const batch = await fetchExamFlashcards(wiki, 15);
      if (batch.items.length === 0) {
        setEmptyHint("该篇暂无知识点闪卡，请先在文库上传并等待拆卡。");
        setCards([]);
        return;
      }
      setCards(batch.items);
      setIndex(0);
      setFlipped(false);
      setScore({ know: 0, total: 0 });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "测验加载失败");
    } finally {
      setStarting(false);
    }
  }, [wiki]);

  const current = cards[index];

  const next = async (knew: boolean) => {
    if (current) {
      const rating: 0 | 1 | 2 | 3 = knew ? 3 : 0;
      await submitSrsReview(current.id, rating).catch(() => undefined);
    }
    setScore((s) => ({ know: s.know + (knew ? 1 : 0), total: s.total + 1 }));
    setFlipped(false);
    if (index + 1 < cards.length) setIndex(index + 1);
    else setIndex(cards.length);
  };

  const finished = index >= cards.length && cards.length > 0;

  return (
    <main className="page exam-page">
      <header className="page-head exam-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">自测</p>
          <h1 className="page-head__title exam-page__title">专题测验</h1>
          <p className="page-head__sub exam-page__sub">选定文库中的一篇，快速自测掌握程度</p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn-secondary btn-sm">
            返回推荐
          </Link>
        </div>
      </header>

      <div className="exam-page__pick">
        <select className="select exam-page__select" value={wiki} onChange={(e) => setWiki(e.target.value)}>
          <option value="">选择篇目…</option>
          {wikis.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={!wiki || starting} onClick={() => void start()}>
          {starting ? "加载中…" : "开始"}
        </button>
      </div>
      {startError ? <p className="feed-center__text feed-center__text--err">{startError}</p> : null}
      {emptyHint ? <p className="feed-center__text">{emptyHint}</p> : null}

      {finished ? (
        <div className="feed-center">
          <p className="feed-center__title">测验结束</p>
          <p className="feed-center__text">
            自评掌握 {score.know} / {score.total}
          </p>
          <Link href="/" className="btn btn-primary">
            回推荐流
          </Link>
          <Link href="/library" className="btn btn-secondary">
            去文库
          </Link>
        </div>
      ) : null}

      {current && !finished ? (
        <div className="exam-page__card">
          <p className="exam-page__progress">
            {index + 1} / {cards.length}
          </p>
          <div className={`feed-slide__panel${flipped ? " feed-slide__panel--back" : " feed-slide__panel--front"}`}>
            {!flipped ? (
              <p className="feed-slide__question">{normalizeFlashcardFront(current.front_text)}</p>
            ) : (
              <FlashcardAnswerMarkdown text={current.back_text} />
            )}
          </div>
          {!flipped ? (
            <button type="button" className="btn btn-primary" onClick={() => setFlipped(true)}>
              显示答案
            </button>
          ) : (
            <div className="review-page__rates">
              <button type="button" className="feed-action feed-action--down" onClick={() => void next(false)}>
                不会
              </button>
              <button type="button" className="feed-action feed-action--up" onClick={() => void next(true)}>
                会了
              </button>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
