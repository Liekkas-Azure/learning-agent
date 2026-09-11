"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  evaluateFeynmanExplanation,
  fetchDueFlashcards,
  fetchFeynmanBrief,
  submitSrsReview,
  type FeynmanBrief,
  type FeynmanEvaluation,
  type KnowledgeFlashcard,
} from "@/lib/api";
import WaitingProgressBar from "@/components/ui/WaitingProgressBar";

type Props = {
  initialCardId?: number | null;
};

type Phase = "explain" | "result";

export default function FeynmanSession({ initialCardId }: Props) {
  const [candidates, setCandidates] = useState<KnowledgeFlashcard[]>([]);
  const [cardId, setCardId] = useState<number | null>(initialCardId ?? null);
  const [brief, setBrief] = useState<FeynmanBrief | null>(null);
  const [explanation, setExplanation] = useState("");
  const [evaluation, setEvaluation] = useState<FeynmanEvaluation | null>(null);
  const [attempt, setAttempt] = useState(1);
  const [phase, setPhase] = useState<Phase>("explain");
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [markingReview, setMarkingReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewMarked, setReviewMarked] = useState(false);

  useEffect(() => {
    void fetchDueFlashcards(12)
      .then((batch) => setCandidates(batch.items))
      .catch(() => setCandidates([]));
  }, []);

  const loadBrief = useCallback(async (id: number) => {
    setLoadingBrief(true);
    setError(null);
    setEvaluation(null);
    setExplanation("");
    setAttempt(1);
    setPhase("explain");
    setReviewMarked(false);
    try {
      const data = await fetchFeynmanBrief(id);
      setBrief(data);
      setCardId(id);
    } catch (e) {
      setBrief(null);
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingBrief(false);
    }
  }, []);

  useEffect(() => {
    if (initialCardId && initialCardId > 0) {
      void loadBrief(initialCardId);
    }
  }, [initialCardId, loadBrief]);

  async function submitExplanation() {
    if (!cardId) return;
    setEvaluating(true);
    setError(null);
    try {
      const result = await evaluateFeynmanExplanation(cardId, {
        explanation,
        attempt,
      });
      setEvaluation(result);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "评估失败");
    } finally {
      setEvaluating(false);
    }
  }

  async function markMastered() {
    if (!cardId) return;
    setMarkingReview(true);
    try {
      await submitSrsReview(cardId, 3);
      setReviewMarked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "写入复习记录失败");
    } finally {
      setMarkingReview(false);
    }
  }

  function tryAgain() {
    setPhase("explain");
    setEvaluation(null);
    setAttempt((n) => n + 1);
    if (evaluation?.followup_prompt) {
      setExplanation((prev) => (prev.trim() ? `${prev.trim()}\n\n` : "") + `（补充）${evaluation.followup_prompt}`);
    }
  }

  const wikiHref =
    brief?.wiki_file_name
      ? `/library?wiki=${encodeURIComponent(brief.wiki_file_name)}${brief.section_id ? `&section=${encodeURIComponent(brief.section_id)}` : ""}`
      : null;

  return (
    <div className="feynman-session">
      {!brief && !loadingBrief ? (
        <section className="page-panel feynman-session__pick">
          <h2 className="feynman-session__pick-title">选一张卡开始讲解</h2>
          <p className="feynman-session__pick-sub">优先从待巩固的卡片里选；也可在推荐流翻面后点「费曼讲解」直接进入。</p>
          {candidates.length ? (
            <ul className="feynman-session__pick-list">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button type="button" className="feynman-session__pick-item" onClick={() => void loadBrief(c.id)}>
                    <span className="feynman-session__pick-topic">{c.topic}</span>
                    <span className="feynman-session__pick-front">{c.front_text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="feynman-session__empty">暂无待巩固卡片。先去推荐流刷读，或上传文库后拆卡。</p>
          )}
          <Link href="/" className="btn btn-secondary btn-sm">
            去推荐流
          </Link>
        </section>
      ) : null}

      {loadingBrief ? (
        <div className="page-panel feynman-session__loading" aria-busy="true">
          <WaitingProgressBar active label="准备题目…" />
        </div>
      ) : null}

      {brief ? (
        <section className="page-panel feynman-session__main">
          <header className="feynman-session__head">
            <p className="feynman-session__kicker">费曼讲解 · 第 {attempt} 轮</p>
            <h2 className="feynman-session__concept">{brief.concept}</h2>
            {brief.source_title ? <p className="feynman-session__source">出处：{brief.source_title}</p> : null}
          </header>

          {phase === "explain" ? (
            <>
              <div className="feynman-session__prompt">
                <p>{brief.prompt}</p>
                <ul className="feynman-session__tips">
                  {brief.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
              <textarea
                className="feynman-session__input"
                rows={7}
                placeholder="在这里写下你的讲解…"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                disabled={evaluating}
              />
              <div className="feynman-session__actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={evaluating || explanation.trim().length < 12}
                  onClick={() => void submitExplanation()}
                >
                  {evaluating ? "评估中…" : "提交讲解"}
                </button>
                {wikiHref ? (
                  <Link href={wikiHref} className="btn btn-ghost btn-sm">
                    查看原文
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setBrief(null);
                    setCardId(null);
                  }}
                >
                  换一题
                </button>
              </div>
            </>
          ) : null}

          {phase === "result" && evaluation ? (
            <div
              className={`feynman-session__result${evaluation.passed ? " feynman-session__result--pass" : ""}`}
              role="status"
            >
              <div className="feynman-session__score-row">
                <span className="feynman-session__score">{evaluation.score}</span>
                <span className="feynman-session__score-label">理解分</span>
                <span className="feynman-session__verdict">{evaluation.passed ? "讲清楚了" : "还有缺口"}</span>
              </div>
              <p className="feynman-session__coach">{evaluation.coach_message}</p>

              {evaluation.strengths.length ? (
                <div className="feynman-session__block">
                  <h3>说得好的地方</h3>
                  <ul>
                    {evaluation.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {evaluation.gaps.length ? (
                <div className="feynman-session__block feynman-session__block--gap">
                  <h3>需要补上的点</h3>
                  <ul>
                    {evaluation.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {evaluation.reference_points.length ? (
                <details className="feynman-session__reference">
                  <summary>参考要点（先自己讲，实在卡住再展开）</summary>
                  <ul>
                    {evaluation.reference_points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="feynman-session__actions">
                {evaluation.passed ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={markingReview || reviewMarked}
                    onClick={() => void markMastered()}
                  >
                    {reviewMarked ? "已记入掌握" : markingReview ? "记录中…" : "记入掌握（SRS）"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={tryAgain}>
                    再讲一轮
                  </button>
                )}
                <Link href="/" className="btn btn-secondary btn-sm">
                  回推荐流
                </Link>
                {!evaluation.passed ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={tryAgain}>
                    修改后重提
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {evaluating ? <WaitingProgressBar active className="feynman-session__progress" label="教练正在读你的讲解…" /> : null}
        </section>
      ) : null}

      {error ? (
        <p className="feynman-session__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
