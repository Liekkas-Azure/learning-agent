"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchDailyDigest, type DailyDigest } from "@/lib/api";
import { getFeedSessionId } from "@/lib/feedSession";
import { getDailyGoal } from "@/lib/productPrefs";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";

export default function DigestPageClient() {
  const [data, setData] = useState<DailyDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchDailyDigest(getFeedSessionId())
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const goal = data?.progress.goal ?? getDailyGoal();
  const goalMet = (data?.progress.today_count ?? 0) >= goal;

  return (
    <main className="page digest-page">
      <header className="page-head digest-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">轻量学习</p>
          <h1 className="page-head__title">今日摘要</h1>
          <p className="page-head__sub">{data?.date ? `${data.date} · 上海时区` : "汇总今天的学习与待办"}</p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn-secondary btn-sm">
            回推荐
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="page-loading" style={{ minHeight: "30vh" }}>
          <div className="app-spinner app-spinner--sm" role="status" aria-label="加载中" />
          <p className="page-loading__text">整理今日摘要…</p>
        </div>
      ) : null}

      {error ? <p className="feed-center__text feed-center__text--err">{error}</p> : null}

      {data && !loading ? (
        <>
          <section className="page-panel digest-page__checklist" aria-label="今日待办">
            <h2 className="page-panel__title">今日待办</h2>
            <ul className="digest-page__todo">
              <li className={goalMet ? "digest-page__todo--done" : ""}>
                {goalMet ? "✓" : "○"} 刷满每日目标（{data.progress.today_count}/{goal} 张）
                {!goalMet ? (
                  <>
                    {" · "}
                    <Link href="/" className="inline-link">
                      去刷推荐流
                    </Link>
                  </>
                ) : null}
              </li>
              <li className={data.due_count === 0 ? "digest-page__todo--done" : ""}>
                {data.due_count === 0 ? "✓" : "○"} 巩固到期卡
                {data.due_count > 0 ? (
                  <>
                    {" "}
                   （{data.due_count} 张）·{" "}
                    <Link href="/review" className="inline-link">
                      去复习
                    </Link>
                  </>
                ) : null}
              </li>
              <li>
                ○ 查看 7 天学习路径 ·{" "}
                <Link href="/learning-path" className="inline-link">
                  打开路径
                </Link>
              </li>
              <li>
                ○ 备份学习成果 ·{" "}
                <Link href="/library#library-export" className="inline-link">
                  导出闪卡与笔记
                </Link>
              </li>
            </ul>
          </section>

          <section className="page-panel digest-page__hero">
            <p className="digest-page__kicker">今日一句</p>
            <blockquote className="digest-page__quote">
              {normalizeFlashcardFront(data.one_liner || "今天还没有记录，去刷一张卡吧。")}
            </blockquote>
            {data.highlight_card?.id ? (
              <Link href="/" className="btn btn-ghost btn-sm">
                回推荐流继续刷
              </Link>
            ) : null}
          </section>

          <section className="page-panel digest-page__stats">
            <h2 className="page-panel__title">进度</h2>
            <div className="digest-page__stat-grid">
              <div className="digest-page__stat">
                <span className="digest-page__stat-num">{data.progress.today_count}</span>
                <span className="digest-page__stat-label">今日互动</span>
              </div>
              <div className="digest-page__stat">
                <span className="digest-page__stat-num">
                  {data.progress.today_count}/{goal}
                </span>
                <span className="digest-page__stat-label">每日目标</span>
              </div>
              <div className="digest-page__stat">
                <span className="digest-page__stat-num">{data.progress.streak_days}</span>
                <span className="digest-page__stat-label">连续天数</span>
              </div>
              <div className="digest-page__stat">
                <span className="digest-page__stat-num">{data.due_count}</span>
                <span className="digest-page__stat-label">待巩固</span>
              </div>
            </div>
          </section>

          {data.top_topics.length > 0 ? (
            <section className="page-panel">
              <h2 className="page-panel__title">你的兴趣画像</h2>
              <p className="page-panel__sub">基于刷读反馈，推荐流会优先推这些主题</p>
              <div className="digest-page__chips">
                {data.top_topics.map((t) => (
                  <span key={t.topic} className="digest-page__chip">
                    {t.topic}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {data.topic_heat.length > 0 ? (
            <section className="page-panel">
              <h2 className="page-panel__title">今日浏览热点</h2>
              <div className="digest-page__chips">
                {data.topic_heat.map((h) => (
                  <span key={h.topic} className="digest-page__chip digest-page__chip--heat">
                    {h.topic}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {data.weak_topics.length > 0 ? (
            <section className="page-panel">
              <h2 className="page-panel__title">待加强主题</h2>
              <div className="digest-page__chips">
                {data.weak_topics.map((t) => (
                  <span key={t} className="digest-page__chip digest-page__chip--weak">
                    {t}
                  </span>
                ))}
              </div>
              <Link href="/learning-path" className="btn btn-secondary btn-sm">
                按薄弱主题安排学习
              </Link>
            </section>
          ) : null}

          {data.mastery_snapshot.length > 0 ? (
            <section className="page-panel">
              <h2 className="page-panel__title">掌握度快照</h2>
              <ul className="digest-page__mastery">
                {data.mastery_snapshot.map((m) => (
                  <li key={m.topic} className="digest-page__mastery-row">
                    <span>{m.topic}</span>
                    <span className="digest-page__mastery-pct">{m.mastery_pct}%</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.saved_recent.length > 0 ? (
            <section className="page-panel">
              <h2 className="page-panel__title">最近搞懂</h2>
              <ul className="digest-page__list">
                {data.saved_recent.map((s, i) => (
                  <li key={s.id ?? i}>{normalizeFlashcardFront(s.front_text || "")}</li>
                ))}
              </ul>
              <Link href="/library#library-saved" className="btn btn-ghost btn-sm">
                查看搞懂清单
              </Link>
            </section>
          ) : null}

          <section className="page-panel digest-page__more">
            <h2 className="page-panel__title">继续学习</h2>
            <div className="digest-page__actions">
              <Link href="/" className="btn btn-primary btn-sm">
                刷推荐流
              </Link>
              <Link href="/review" className="btn btn-secondary btn-sm">
                巩固复习
              </Link>
              <Link href="/exam" className="btn btn-secondary btn-sm">
                专题测验
              </Link>
              <Link href="/library#library-export" className="btn btn-secondary btn-sm">
                导出资料
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
