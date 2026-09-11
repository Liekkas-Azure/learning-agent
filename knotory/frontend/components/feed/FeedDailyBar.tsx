"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyProgress, FlashcardProfile } from "@/lib/api";
import { getDailyGoal, setDailyGoal } from "@/lib/productPrefs";

const GOAL_OPTIONS = [3, 5, 10] as const;

type Props = {
  daily: DailyProgress | null;
  profile: FlashcardProfile | null;
  dueCount: number;
  isDemo?: boolean;
  onGoalChange?: () => void;
};

export default function FeedDailyBar({ daily, profile, dueCount, isDemo = false, onGoalChange }: Props) {
  const [goal, setGoalState] = useState(() => daily?.goal ?? getDailyGoal());
  const today = daily?.today_count ?? 0;
  const remaining = Math.max(0, goal - today);
  const pct = Math.min(100, Math.round((today / Math.max(goal, 1)) * 100));
  const streak = daily?.streak_days ?? 0;
  const goalMet = today >= goal;
  const weak = profile?.mastery?.filter((m) => m.mastery_pct < 45).slice(0, 2) ?? [];
  const heat = profile?.daily_topic_heat?.slice(0, 2) ?? [];
  const stylePref = profile?.style_preference;
  const topInterest = profile?.top_topics?.slice(0, 2) ?? [];

  useEffect(() => {
    if (daily?.goal) setGoalState(daily.goal);
  }, [daily?.goal]);

  useEffect(() => {
    const sync = () => setGoalState(getDailyGoal());
    window.addEventListener("knotory-daily-goal-change", sync);
    return () => window.removeEventListener("knotory-daily-goal-change", sync);
  }, []);

  const pickGoal = (n: number) => {
    setDailyGoal(n);
    setGoalState(n);
    onGoalChange?.();
  };

  return (
    <div className="feed-daily-bar" aria-label="今日学习概览">
      <div className="feed-daily-bar__row">
        <div className="feed-daily-bar__goal">
          <div className="feed-daily-bar__goal-head">
            <span className="feed-daily-bar__label">今日目标</span>
            <div className="feed-daily-bar__goal-picks" role="group" aria-label="每日目标张数">
              {GOAL_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`feed-daily-bar__goal-btn${goal === n ? " feed-daily-bar__goal-btn--active" : ""}`}
                  onClick={() => pickGoal(n)}
                  aria-pressed={goal === n}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <span className="feed-daily-bar__nums">
            {today}/{goal} 张
            {goalMet ? (
              <span className="feed-daily-bar__met"> · 今日达标 ✓</span>
            ) : remaining > 0 ? (
              <span className="feed-daily-bar__remain"> · 还差 {remaining} 张</span>
            ) : null}
          </span>
          <div className="feed-daily-bar__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="feed-daily-bar__fill" style={{ width: `${Math.max(pct, today > 0 ? 8 : 0)}%` }} />
          </div>
        </div>
        {streak > 0 ? (
          <div
            className="feed-daily-bar__streak"
            title="连续有效学习日：每天至少互动 3 次（翻面/掌握/保存/跳过）"
          >
            🔥 {streak} 天
          </div>
        ) : (
          <div className="feed-daily-bar__streak feed-daily-bar__streak--muted" title="今天互动 3 次即可开始连续打卡">
            打卡
          </div>
        )}
        {dueCount > 0 ? (
          <Link href="/review" className="feed-daily-bar__due">
            待巩固 {dueCount}
          </Link>
        ) : null}
        <Link href="/digest" className="feed-daily-bar__digest">
          今日摘要
        </Link>
        <Link href="/learning-path" className="feed-daily-bar__digest">
          学习路径
        </Link>
        <Link href="/feynman" className="feed-daily-bar__digest">
          费曼讲解
        </Link>
      </div>

      {goalMet ? (
        <p className="feed-daily-bar__celebrate" role="status">
          今日目标已完成 ·{" "}
          <Link href="/digest" className="inline-link">
            看摘要
          </Link>
          {" · "}
          <Link href="/library#library-export" className="inline-link">
            导出笔记
          </Link>
        </p>
      ) : null}

      {!isDemo ? (
        <p className="feed-daily-bar__trust">
          每张卡来自<strong>你上传的文库</strong>，可随时{" "}
          <Link href="/library#library-export" className="inline-link">
            导出闪卡与笔记
          </Link>
        </p>
      ) : null}

      {stylePref?.summary ? (
        <p className="feed-daily-bar__pref" title="基于你的保存、重写与反馈">
          {stylePref.labels.length > 0 ? (
            <>
              <span className="feed-daily-bar__pref-label">讲法偏好</span>
              {stylePref.labels.map((l) => (
                <span key={l} className="feed-daily-bar__mastery-chip">
                  {l}
                </span>
              ))}
              <span className="feed-daily-bar__pref-text">{stylePref.summary}</span>
            </>
          ) : (
            stylePref.summary
          )}
        </p>
      ) : topInterest.length > 0 && !isDemo ? (
        <p className="feed-daily-bar__pref">
          <span className="feed-daily-bar__pref-label">兴趣画像</span>
          {topInterest.map((t) => (
            <span key={t.topic} className="feed-daily-bar__mastery-chip">
              {t.topic}
            </span>
          ))}
          <span className="feed-daily-bar__pref-text">推荐流会优先推你常刷、待加强的主题</span>
        </p>
      ) : null}

      {isDemo ? (
        <p className="feed-daily-bar__demo-hint">
          示例模式 · <Link href="/library">上传你的文库</Link> 后可刷专属材料并导出
        </p>
      ) : null}
      {weak.length > 0 ? (
        <div className="feed-daily-bar__mastery">
          <span className="feed-daily-bar__mastery-label">待加强</span>
          {weak.map((m) => (
            <span key={m.topic} className="feed-daily-bar__mastery-chip" title={`掌握度 ${m.mastery_pct}%`}>
              {m.topic} {m.mastery_pct}%
            </span>
          ))}
        </div>
      ) : heat.length > 0 ? (
        <div className="feed-daily-bar__mastery">
          <span className="feed-daily-bar__mastery-label">今日热点</span>
          {heat.map((h) => (
            <span key={h.topic} className="feed-daily-bar__mastery-chip">
              {h.topic}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
