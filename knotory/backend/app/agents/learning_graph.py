"""
个性化学习闭环 Agent：诊断 → 规划 → 执行 → 评估 → 重规划。

优先使用 LangGraph；未安装时回退到同构状态机，保证 API 一致。
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from app.agents.learning_policy import choose_teaching_action
from app.agents.learning_planner import refine_plan_with_llm
from app.agents.learning_tools import execute_learning_tool
from app.contextual_bandit import arm_stats, record_reward
from app.flashcard_export import build_learning_path_heuristic
from app.flashcard_srs import list_due_flashcards, mastery_by_topic
from app.knowledge_graph import prerequisite_blockers
from app.student_state import build_student_state_snapshot, weak_concepts
from app.wiki_memory import list_memory_episodes, reflect_and_write

logger = logging.getLogger("knotory.learning_graph")

try:
    from langgraph.graph import END, StateGraph  # type: ignore

    _HAS_LANGGRAPH = True
except Exception:  # noqa: BLE001
    _HAS_LANGGRAPH = False
    END = "END"  # type: ignore
    StateGraph = None  # type: ignore


class LearningAgentState(TypedDict, total=False):
    goal: str
    days: int
    diagnosis: dict[str, Any]
    plan: dict[str, Any]
    policy: dict[str, Any]
    execution: dict[str, Any]
    execution_history: list[dict[str, Any]]
    evaluation: dict[str, Any]
    memory_write: dict[str, Any]
    needs_replan: bool
    replan_count: int
    attempted_actions: list[str]
    forced_action: str
    engine_used: str
    trace: list[str]
    final: dict[str, Any]


def _diagnose(state: LearningAgentState) -> LearningAgentState:
    snapshot = build_student_state_snapshot(use_llm=True)
    due = list_due_flashcards(limit=12)
    weak = weak_concepts(limit=8)
    blockers = prerequisite_blockers(
        [str(item.get("concept_label") or "") for item in weak]
    )
    srs_mastery = mastery_by_topic()
    diagnosis = {
        "summary": snapshot["summary"],
        "weak_concepts": weak,
        "prerequisite_blockers": blockers,
        "strong_concepts": snapshot.get("strong_concepts") or [],
        "profile": snapshot.get("profile") or {},
        "observation_sources": snapshot.get("observation_sources") or {},
        "due_count": len(due),
        "srs_mastery": srs_mastery[:8],
        "memory_episodes": list_memory_episodes(limit=5),
        "bandit": arm_stats(),
    }
    trace = list(state.get("trace") or [])
    trace.append("diagnose")
    return {**state, "diagnosis": diagnosis, "trace": trace}


def _plan(state: LearningAgentState) -> LearningAgentState:
    days = int(state.get("days") or 7)
    diagnosis = state.get("diagnosis") or {}
    weak = diagnosis.get("weak_concepts") or []
    due_count = int(diagnosis.get("due_count") or 0)
    blockers = diagnosis.get("prerequisite_blockers") or []
    profile = diagnosis.get("profile") or {}
    preferred_actions = profile.get("preferred_actions") or []
    preferred_action = (
        str(preferred_actions[0].get("name") or "")
        if preferred_actions and isinstance(preferred_actions[0], dict)
        else ""
    )
    recent_memory = diagnosis.get("memory_episodes") or []

    base = build_learning_path_heuristic(days=days)
    # 先修阻塞优先于目标弱项；BKT/DKT 融合状态决定后续焦点。
    steps = []
    for i, step in enumerate(base.get("steps") or []):
        if i < len(blockers):
            focus = blockers[i]["prerequisite_key"]
        elif i - len(blockers) < len(weak):
            focus = weak[i - len(blockers)]["concept_label"]
        else:
            focus = step.get("focus_topic") or ""
        why = (
            f"知识图谱显示「{focus}」是当前目标的未掌握先修知识"
            if i < len(blockers)
            else (
                f"BKT/DKT 显示「{focus}」掌握度约 "
                f"{weak[i - len(blockers)]['mastery_pct']}%，优先诊断巩固"
                if i - len(blockers) < len(weak)
                else step.get("why") or ""
            )
        )
        tasks = list(step.get("tasks") or [])
        weak_index = i - len(blockers)
        if 0 <= weak_index < len(weak):
            errors = weak[weak_index].get("error_patterns") or []
            if errors:
                tasks.insert(0, f"纠正典型错误：{str(errors[0])[:80]}")
        if preferred_action:
            tasks.append(f"采用偏好学习方式：{preferred_action}")
        if recent_memory and i == 0:
            memory_title = str(recent_memory[0].get("title") or "")
            if memory_title:
                tasks.append(f"复用历史经验：{memory_title[:80]}")
        steps.append(
            {
                **step,
                "focus_topic": focus or step.get("focus_topic"),
                "why": why,
                "tasks": tasks[:6],
                "actions": list(step.get("actions") or [])[:4],
            }
        )

    plan = {
        **base,
        "steps": steps,
        "goal": state.get("goal") or "个性化学习闭环",
        "planner": state.get("engine_used") or "state_machine",
        "replanned": int(state.get("replan_count") or 0) > 0,
        "replan_reason": (state.get("evaluation") or {}).get("issues") or [],
        "previous_actions": list(state.get("attempted_actions") or []),
        "constraints": {
            "prefer_weak_concepts": [w.get("concept_label") for w in weak[:5]],
            "prerequisite_blockers": blockers[:5],
            "due_count": due_count,
        },
    }
    plan = refine_plan_with_llm(
        goal=str(state.get("goal") or "个性化学习闭环"),
        diagnosis=diagnosis,
        base_plan=plan,
        days=days,
    )
    trace = list(state.get("trace") or [])
    trace.append("plan")
    return {**state, "plan": plan, "trace": trace, "needs_replan": False}


def _policy(state: LearningAgentState) -> LearningAgentState:
    decision = choose_teaching_action(
        diagnosis={
            **(state.get("diagnosis") or {}),
            "attempted_actions": state.get("attempted_actions") or [],
        },
        plan=state.get("plan") or {},
        attempted_actions=state.get("attempted_actions") or [],
        forced_action=state.get("forced_action") or "",
    )
    plan = {**(state.get("plan") or {}), "primary_action": decision["action"]}
    trace = list(state.get("trace") or [])
    trace.append("policy")
    return {
        **state,
        "policy": decision,
        "plan": plan,
        "forced_action": "",
        "trace": trace,
    }


def _execute(state: LearningAgentState) -> LearningAgentState:
    plan = state.get("plan") or {}
    policy = state.get("policy") or {}
    primary = policy.get("action") or plan.get("primary_action") or "feed_review"
    steps = plan.get("steps") or []
    first = steps[0] if steps else {}
    execution = execute_learning_tool(
        str(primary),
        arguments=policy.get("arguments") or {},
        context={
            "focus_concept": first.get("focus_topic") or first.get("title") or "",
            "wiki_file_name": first.get("wiki_file_name") or "",
        },
    )
    execution = {
        **execution,
        "primary_action": primary,
        "policy": policy.get("policy"),
        "today_focus": first.get("focus_topic") or first.get("title") or "",
        "tasks": first.get("tasks") or [],
    }
    attempted = list(state.get("attempted_actions") or [])
    attempted.append(str(primary))
    history = list(state.get("execution_history") or [])
    history.append(execution)
    trace = list(state.get("trace") or [])
    trace.append("execute")
    return {
        **state,
        "execution": execution,
        "execution_history": history,
        "attempted_actions": attempted,
        "trace": trace,
    }


def _evaluate(state: LearningAgentState) -> LearningAgentState:
    diagnosis = state.get("diagnosis") or {}
    plan = state.get("plan") or {}
    execution = state.get("execution") or {}
    weak = diagnosis.get("weak_concepts") or []
    due_count = int(diagnosis.get("due_count") or 0)
    steps = plan.get("steps") or []

    issues: list[str] = []
    if not execution.get("ok"):
        issues.append(f"工具执行失败：{execution.get('error') or '未知错误'}")
    if due_count >= 15 and plan.get("primary_action") not in {"srs_due", "exam"}:
        issues.append("到期卡积压严重，当前主 Action 未优先巩固")
    if weak and not any((s.get("focus_topic") or "") for s in steps[:3]):
        issues.append("弱概念未落入近三日路径焦点")
    if not steps:
        issues.append("规划步骤为空，无法执行")

    retryable = bool(execution.get("retryable", True))
    needs_replan = (
        bool(issues)
        and retryable
        and int(state.get("replan_count") or 0) < 2
    )
    evaluation = {
        "ok": not issues,
        "issues": issues,
        "needs_replan": needs_replan,
        "score": 0.9 if not issues else 0.45,
    }
    try:
        record_reward(
            str(plan.get("primary_action") or "feed_review"),
            0.6 if execution.get("ok") else 0.0,
            context_key=str(execution.get("today_focus") or ""),
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("operational bandit feedback skipped: %s", exc)
    trace = list(state.get("trace") or [])
    trace.append("evaluate")
    return {**state, "evaluation": evaluation, "needs_replan": needs_replan, "trace": trace}


def _memory(state: LearningAgentState) -> LearningAgentState:
    diagnosis = state.get("diagnosis") or {}
    evaluation = state.get("evaluation") or {}
    plan = state.get("plan") or {}
    weak = diagnosis.get("weak_concepts") or []
    concepts = [str(w.get("concept_label") or "") for w in weak[:6] if w.get("concept_label")]
    replanned = int(state.get("replan_count") or 0) > 0
    written = reflect_and_write(
        event="learning_replan" if replanned else "learning_plan",
        payload={
            "summary": diagnosis.get("summary"),
            "profile": diagnosis.get("profile") or {},
            "replan": replanned,
            "replan_count": state.get("replan_count") or 0,
            "gaps": evaluation.get("issues") or [],
            "primary_action": plan.get("primary_action"),
            "concept": concepts[0] if concepts else "",
            "execution_history": state.get("execution_history") or [],
        },
        concepts=concepts,
    )
    trace = list(state.get("trace") or [])
    trace.append("memory")
    return {**state, "memory_write": written, "trace": trace}


def _replan(state: LearningAgentState) -> LearningAgentState:
    """记录失败约束；随后重新诊断、规划并交给 Policy 选择下一 Action。"""
    diagnosis = state.get("diagnosis") or {}
    due_count = int(diagnosis.get("due_count") or 0)
    attempted = set(state.get("attempted_actions") or [])
    if due_count >= 1 and "srs_due" not in attempted:
        forced = "srs_due"
    elif "feynman" not in attempted:
        forced = "feynman"
    elif "deep_read" not in attempted:
        forced = "deep_read"
    else:
        forced = "feed_review"
    trace = list(state.get("trace") or [])
    trace.append("replan")
    return {
        **state,
        "forced_action": forced,
        "needs_replan": False,
        "replan_count": int(state.get("replan_count") or 0) + 1,
        "trace": trace,
    }


def _finalize(state: LearningAgentState) -> LearningAgentState:
    final = {
        "goal": state.get("goal") or "个性化学习闭环",
        "diagnosis": state.get("diagnosis"),
        "plan": state.get("plan"),
        "policy": state.get("policy"),
        "execution": state.get("execution"),
        "execution_history": state.get("execution_history") or [],
        "evaluation": state.get("evaluation"),
        "memory_write": state.get("memory_write"),
        "trace": state.get("trace") or [],
        "engine": state.get("engine_used") or "state_machine",
        "loop": [
            "diagnose",
            "plan",
            "policy",
            "execute",
            "evaluate",
            "replan?",
            "memory",
        ],
    }
    return {**state, "final": final}


def _route_after_evaluate(state: LearningAgentState) -> str:
    if state.get("needs_replan"):
        return "replan"
    return "memory"


def _build_langgraph():
    graph = StateGraph(LearningAgentState)
    graph.add_node("diagnose_node", _diagnose)
    graph.add_node("plan_node", _plan)
    graph.add_node("policy_node", _policy)
    graph.add_node("execute_node", _execute)
    graph.add_node("evaluate_node", _evaluate)
    graph.add_node("replan_node", _replan)
    graph.add_node("memory_node", _memory)
    graph.add_node("finalize_node", _finalize)

    graph.set_entry_point("diagnose_node")
    graph.add_edge("diagnose_node", "plan_node")
    graph.add_edge("plan_node", "policy_node")
    graph.add_edge("policy_node", "execute_node")
    graph.add_edge("execute_node", "evaluate_node")
    graph.add_conditional_edges(
        "evaluate_node",
        _route_after_evaluate,
        {"replan": "replan_node", "memory": "memory_node"},
    )
    graph.add_edge("replan_node", "diagnose_node")
    graph.add_edge("memory_node", "finalize_node")
    graph.add_edge("finalize_node", END)
    return graph.compile()


def _run_state_machine(initial: LearningAgentState) -> LearningAgentState:
    state = _diagnose(initial)
    state = _plan(state)
    state = _policy(state)
    state = _execute(state)
    state = _evaluate(state)
    while state.get("needs_replan"):
        state = _replan(state)
        state = _diagnose(state)
        state = _plan(state)
        state = _policy(state)
        state = _execute(state)
        state = _evaluate(state)
    state = _memory(state)
    return _finalize(state)


_COMPILED = None


def run_learning_loop(*, goal: str = "个性化学习闭环", days: int = 7) -> dict[str, Any]:
    """对外入口：跑完诊断-规划-执行-评估-(重规划)-记忆写回。"""
    initial: LearningAgentState = {
        "goal": goal,
        "days": days,
        "replan_count": 0,
        "attempted_actions": [],
        "execution_history": [],
        "trace": [],
    }
    global _COMPILED
    if _HAS_LANGGRAPH:
        try:
            if _COMPILED is None:
                _COMPILED = _build_langgraph()
            result = _COMPILED.invoke({**initial, "engine_used": "langgraph"})
            return dict(result.get("final") or result)
        except Exception as exc:  # noqa: BLE001
            logger.warning("langgraph run failed, fallback state machine: %s", exc)
    result = _run_state_machine({**initial, "engine_used": "state_machine"})
    return dict(result.get("final") or result)
