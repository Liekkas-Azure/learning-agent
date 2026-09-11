"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import FlashcardTrustBadge from "@/components/feed/FlashcardTrustBadge";
import FlashcardVisual from "@/components/feed/FlashcardVisual";
import {
  fetchDueFlashcards,
  fetchFlashcardNote,
  fetchSrsCalendar,
  fetchSrsTrend,
  saveFlashcardNote,
  submitSrsReview,
  type KnowledgeFlashcard,
  type MasteryTopic,
} from "@/lib/api";
import FlashcardAnswerMarkdown from "@/components/feed/FlashcardAnswerMarkdown";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";

function masteryFillStyle(pct: number): CSSProperties {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const tone = Math.round(20 + t * 55);
  return {
    width: `${Math.max(6, pct)}%`,
    ["--mastery-tone" as string]: `${tone}%`,
  };
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ReviewPage() {
  const [cards, setCards] = useState<KnowledgeFlashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [calendar, setCalendar] = useState<Array<{ date: string; due_count: number }>>([]);
  const [mastery, setMastery] = useState<MasteryTopic[]>([]);
  const [dueSummary, setDueSummary] = useState({ overdue: 0, due_today: 0, due_this_week: 0 });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const batch = await fetchDueFlashcards(30);
      setCards(batch.items);
      setIndex(0);
      setFlipped(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [cal, trend] = await Promise.all([fetchSrsCalendar(14), fetchSrsTrend(8)]);
      setCalendar(cal.items);
      setMastery(trend.mastery);
      setDueSummary(trend.due_summary);
    } catch {
      setCalendar([]);
      setMastery([]);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAnalytics();
  }, [load, loadAnalytics]);

  const current = cards[index];
  const maxDue = Math.max(1, ...calendar.map((d) => d.due_count));

  useEffect(() => {
    if (!current) return;
    void fetchFlashcardNote(current.id).then(setNoteText);
  }, [current?.id]);

  const rate = async (rating: 0 | 1 | 2 | 3) => {
    if (!current) return;
    if (noteText.trim()) {
      await saveFlashcardNote(current.id, noteText).catch(() => undefined);
    }
    await submitSrsReview(current.id, rating);
    setDone((d) => d + 1);
    setFlipped(false);
    setNoteText("");
    void loadAnalytics();
    if (index + 1 < cards.length) {
      setIndex(index + 1);
    } else {
      const batch = await fetchDueFlashcards(30);
      setCards(batch.items);
      setIndex(0);
    }
  };

  return (
    <main className="page review-page">
      <header className="page-head review-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">间隔复习</p>
          <h1 className="page-head__title review-page__title">巩固复习</h1>
          <p className="page-head__sub review-page__sub">到期知识点 · 已完成 {done} 张</p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn-secondary btn-sm">
            返回推荐
          </Link>
        </div>
      </header>

      <section className="review-page__analytics" aria-label="复习概览">
        {analyticsLoading ? (
          <p className="review-page__analytics-loading">加载复习数据…</p>
        ) : (
          <>
            <div className="review-page__due-stats">
              <div className="review-page__due-stat review-page__due-stat--overdue">
                <span className="review-page__due-num">{dueSummary.overdue}</span>
                <span className="review-page__due-label">已逾期</span>
              </div>
              <div className="review-page__due-stat">
                <span className="review-page__due-num">{dueSummary.due_today}</span>
                <span className="review-page__due-label">今日到期</span>
              </div>
              <div className="review-page__due-stat">
                <span className="review-page__due-num">{dueSummary.due_this_week}</span>
                <span className="review-page__due-label">本周内</span>
              </div>
            </div>

            {calendar.length ? (
              <div className="review-page__calendar">
                <h2 className="review-page__panel-title">复习日历（14 天）</h2>
                <div className="review-page__calendar-bars" role="img" aria-label="未来两周每日到期闪卡数量">
                  {calendar.map((day) => (
                    <div key={day.date} className="review-page__calendar-col" title={`${day.date}：${day.due_count} 张`}>
                      <div
                        className="review-page__calendar-bar"
                        style={{ height: `${Math.max(4, (day.due_count / maxDue) * 100)}%` }}
                      />
                      <span className="review-page__calendar-label">{formatShortDate(day.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mastery.length ? (
              <div className="review-page__mastery">
                <h2 className="review-page__panel-title">主题掌握度</h2>
                <div className="review-page__mastery-list">
                  {mastery.slice(0, 6).map((m) => (
                    <div key={m.topic} className="review-page__mastery-row">
                      <span className="review-page__mastery-label" title={m.topic}>
                        {m.topic}
                      </span>
                      <span className="review-page__mastery-bar">
                        <span className="review-page__mastery-fill" style={masteryFillStyle(m.mastery_pct)} />
                      </span>
                      <span className="review-page__mastery-pct">{m.mastery_pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {error ? (
        <div className="feed-center">
          <p className="feed-center__text feed-center__text--err">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {loading ? <p className="feed-center__text">加载待复习卡片…</p> : null}

      {!loading && cards.length === 0 ? (
        <div className="feed-center">
          <p className="feed-center__title">暂无到期卡片</p>
          <p className="feed-center__text">去推荐流刷几张新卡，或稍后再来巩固。</p>
          <Link href="/" className="btn btn-primary">
            去推荐
          </Link>
        </div>
      ) : null}

      {current ? (
        <div className="review-page__card">
          <FlashcardVisual card={current} compact />
          <FlashcardTrustBadge card={current} />
          <p className="feed-explain">{current.feed_explain || "待复习"}</p>
          <div className={`feed-slide__panel${flipped ? " feed-slide__panel--back" : " feed-slide__panel--front"}`}>
            {!flipped ? (
              <p className="feed-slide__question">{normalizeFlashcardFront(current.front_text)}</p>
            ) : (
              <FlashcardAnswerMarkdown text={current.back_text} />
            )}
          </div>
          {current.source_wiki_url ? (
            <Link href={current.source_wiki_url} className="feed-slide__source-link">
              阅读原文 →
            </Link>
          ) : null}
          <textarea
            className="review-page__note"
            placeholder="复习笔记（同步服务端）"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setFlipped((f) => !f)}>
            {flipped ? "看问题" : "看答案"}
          </button>
          <div className="review-page__rates">
            <button type="button" className="feed-action feed-action--down" onClick={() => void rate(0)}>
              重来
            </button>
            <button type="button" className="feed-action" onClick={() => void rate(1)}>
              困难
            </button>
            <button type="button" className="feed-action feed-action--save" onClick={() => void rate(2)}>
              良好
            </button>
            <button type="button" className="feed-action feed-action--up" onClick={() => void rate(3)}>
              简单
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
