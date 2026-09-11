"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  fetchLearningPath,
  submitLearningActionFeedback,
  type LearningAction,
  type LearningAgentResult,
  type MasteryTopic,
} from "@/lib/api";

type Step = {
  day: number;
  title: string;
  wiki_file_name: string;
  focus_topic?: string;
  tasks: string[];
  why?: string;
  actions?: { label: string; href: string }[];
};

function masteryFillStyle(pct: number): CSSProperties {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const tone = Math.round(20 + t * 55);
  return {
    width: `${Math.max(6, pct)}%`,
    ["--mastery-tone" as string]: `${tone}%`,
  };
}

export default function LearningPathPage() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [mastery, setMastery] = useState<MasteryTopic[]>([]);
  const [weak, setWeak] = useState<string[]>([]);
  const [agent, setAgent] = useState<LearningAgentResult | null>(null);
  const [strategySummary, setStrategySummary] = useState("");
  const [primaryAction, setPrimaryAction] = useState<LearningAction | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLearningPath(7);
      setSteps(data.steps as Step[]);
      setMastery(data.mastery ?? []);
      setWeak(data.weak_topics ?? []);
      setAgent(data.agent ?? null);
      setStrategySummary(data.strategy_summary ?? "");
      setPrimaryAction(
        data.primary_action ?? data.agent?.policy?.action ?? null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendAgentFeedback = useCallback(
    async (reward: number) => {
      if (!primaryAction) return;
      try {
        await submitLearningActionFeedback(
          primaryAction,
          reward,
          agent?.policy?.context_key ?? "",
        );
        setFeedbackMessage(reward >= 0.5 ? "已记录：这个安排有效" : "已记录：下次将调整策略");
      } catch {
        setFeedbackMessage("反馈提交失败，请稍后重试");
      }
    },
    [agent?.policy?.context_key, primaryAction],
  );

  return (
    <main className="page learning-path-page">
      <header className="page-head learning-path-page__head">
        <div className="page-head__main learning-path-page__head-main">
          <p className="page-head__eyebrow learning-path-page__eyebrow">规划</p>
          <h1 className="page-head__title learning-path-page__title">学习路径</h1>
          <p className="page-head__sub learning-path-page__sub">
            按薄弱主题与掌握度安排轻量任务 · 推荐流刷读 + 摘要复盘
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn-secondary btn-sm learning-path-page__back">
            返回推荐
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="learning-path-page__loading" aria-busy="true" aria-label="加载学习路径">
          <div className="learning-path-page__skeleton learning-path-page__skeleton--panel" />
          <div className="learning-path-page__skeleton learning-path-page__skeleton--panel" />
          <div className="learning-path-page__skeleton learning-path-page__skeleton--step" />
          <div className="learning-path-page__skeleton learning-path-page__skeleton--step" />
        </div>
      ) : null}

      {error ? (
        <div className="feed-center learning-path-page__error">
          <p className="feed-center__text feed-center__text--err">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          {agent ? (
            <section className="learning-path-page__panel" aria-label="Agent 决策闭环">
              <div className="learning-path-page__timeline-head">
                <div>
                  <h2 className="learning-path-page__panel-title">Agent 决策闭环</h2>
                  <p className="learning-path-page__panel-desc">
                    {agent.diagnosis_summary || strategySummary || "已基于实时 Student State 生成计划"}
                  </p>
                </div>
                <span className="learning-path-page__focus-tag">
                  {agent.engine === "langgraph" ? "LangGraph" : "Fallback"}
                  {agent.replanned ? " · 已重规划" : ""}
                </span>
              </div>

              {agent.trace?.length ? (
                <p className="learning-path-page__why">
                  {agent.trace.join(" → ")}
                </p>
              ) : null}

              {agent.diagnosis?.prerequisite_blockers?.length ? (
                <div className="learning-path-page__chips">
                  {agent.diagnosis.prerequisite_blockers.slice(0, 5).map((item) => (
                    <span
                      key={`${item.prerequisite_key}-${item.concept_key}`}
                      className="learning-path-page__chip"
                    >
                      先修 {item.prerequisite_key} · {item.mastery_pct}%
                    </span>
                  ))}
                </div>
              ) : null}

              {agent.execution?.cta ? (
                <div className="learning-path-page__actions">
                  <Link
                    href={agent.execution.cta.href}
                    className="btn btn-primary btn-sm"
                    onClick={() => void sendAgentFeedback(0.65)}
                  >
                    {agent.execution.cta.label}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void sendAgentFeedback(1)}
                  >
                    这个安排有效
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void sendAgentFeedback(0)}
                  >
                    不适合我
                  </button>
                  {feedbackMessage ? (
                    <span className="learning-path-page__panel-desc" role="status">
                      {feedbackMessage}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {agent.evaluation?.issues?.length ? (
                <ul className="learning-path-page__tasks">
                  {agent.evaluation.issues.map((issue) => (
                    <li key={issue} className="learning-path-page__task">
                      评估：{issue}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {weak.length ? (
            <section className="learning-path-page__panel" aria-label="薄弱主题">
              <h2 className="learning-path-page__panel-title">当前薄弱主题</h2>
              <p className="learning-path-page__panel-desc">优先安排这些主题的阅读与测验</p>
              <div className="learning-path-page__chips">
                {weak.map((topic) => (
                  <span key={topic} className="learning-path-page__chip">
                    {topic}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {mastery.length ? (
            <section className="learning-path-page__panel" aria-label="主题掌握度">
              <h2 className="learning-path-page__panel-title">主题掌握度</h2>
              <div className="learning-path-page__mastery-list">
                {mastery.slice(0, 8).map((m) => (
                  <div key={m.topic} className="learning-path-page__mastery-row">
                    <span className="learning-path-page__mastery-label" title={m.topic}>
                      {m.topic}
                    </span>
                    <span className="learning-path-page__mastery-bar">
                      <span
                        className="learning-path-page__mastery-fill"
                        style={masteryFillStyle(m.mastery_pct)}
                      />
                    </span>
                    <span className="learning-path-page__mastery-pct">{m.mastery_pct}%</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="learning-path-page__timeline" aria-label="每日计划">
            <div className="learning-path-page__timeline-head">
              <h2 className="learning-path-page__panel-title">每日计划</h2>
              <span className="learning-path-page__timeline-count">{steps.length} 天</span>
            </div>

            {steps.length === 0 ? (
              <div className="learning-path-page__empty">
                <p className="learning-path-page__empty-title">暂无学习计划</p>
                <p className="learning-path-page__empty-desc">请先在文库上传材料，生成知识点闪卡</p>
                <Link href="/library" className="btn btn-primary btn-sm">
                  去文库
                </Link>
              </div>
            ) : (
              <ol className="learning-path-page__steps">
                {steps.map((s, i) => (
                  <li key={s.day} className="learning-path-page__step">
                    <div className="learning-path-page__rail" aria-hidden="true">
                      <span className="learning-path-page__day-badge">{s.day}</span>
                      {i < steps.length - 1 ? <span className="learning-path-page__rail-line" /> : null}
                    </div>
                    <article className="learning-path-page__step-card">
                      <header className="learning-path-page__step-head">
                        <h3 className="learning-path-page__step-title">{s.title}</h3>
                        {s.focus_topic ? (
                          <span className="learning-path-page__focus-tag">{s.focus_topic}</span>
                        ) : null}
                      </header>
                      {s.why ? <p className="learning-path-page__why">{s.why}</p> : null}
                      <ul className="learning-path-page__tasks">
                        {s.tasks.map((t) => (
                          <li key={t} className="learning-path-page__task">
                            {t}
                          </li>
                        ))}
                      </ul>
                      <div className="learning-path-page__actions">
                        {(s.actions?.length
                          ? s.actions
                          : [
                              { label: "刷推荐流", href: "/" },
                              { label: "巩固复习", href: "/review" },
                              ...(s.wiki_file_name
                                ? [
                                    {
                                      label: "深读此文",
                                      href: `/library?wiki=${encodeURIComponent(s.wiki_file_name)}`,
                                    },
                                  ]
                                : []),
                            ]
                        ).map((action, actionIndex) => (
                          <Link
                            key={`${action.href}-${action.label}`}
                            href={action.href}
                            className={`btn ${
                              actionIndex === 0 ? "btn-primary" : "btn-secondary"
                            } btn-sm`}
                          >
                            {action.label}
                          </Link>
                        ))}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
