"""知识图谱结构：概念、先修边及 Planner 约束查询。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.graph_neo4j import get_driver, sync_concepts
from app.models import KnowledgePrerequisite
from app.storage import engine
from app.student_state import concept_key_from_label
from app.tenant import current_user_id


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def sync_knowledge_structure(
    *,
    doc_slug: str,
    concepts: list[str],
    prerequisites: list[dict[str, Any]],
    source_wiki: str,
) -> dict[str, int]:
    """同时写 SQLite 与 Neo4j，Neo4j 不可用时仍保留规划约束。"""
    normalized = [str(c).strip() for c in concepts if str(c).strip()][:40]
    sync_concepts(doc_slug, normalized)

    owner = current_user_id()
    valid_edges: list[tuple[str, str, float]] = []
    for edge in prerequisites[:40]:
        before = str(edge.get("before") or "").strip()
        after = str(edge.get("after") or "").strip()
        if not before or not after:
            continue
        before_key = concept_key_from_label(before)
        after_key = concept_key_from_label(after)
        if before_key == after_key:
            continue
        try:
            confidence = max(0.0, min(1.0, float(edge.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        if confidence < 0.45:
            continue
        valid_edges.append((before_key, after_key, confidence))

    with Session(engine) as session:
        for before, after, confidence in valid_edges:
            row = session.exec(
                select(KnowledgePrerequisite).where(
                    KnowledgePrerequisite.user_id == owner,
                    KnowledgePrerequisite.prerequisite_key == before,
                    KnowledgePrerequisite.concept_key == after,
                )
            ).first()
            if row is None:
                row = KnowledgePrerequisite(
                    user_id=owner,
                    prerequisite_key=before,
                    concept_key=after,
                )
            row.confidence = confidence
            row.source = "llm"
            row.source_wiki = source_wiki[:512]
            row.updated_at = _utcnow()
            session.add(row)
        session.commit()

    _sync_prerequisites_neo4j(doc_slug=doc_slug, edges=valid_edges)
    return {"concepts": len(normalized), "prerequisites": len(valid_edges)}


def _sync_prerequisites_neo4j(
    *,
    doc_slug: str,
    edges: list[tuple[str, str, float]],
) -> None:
    driver = get_driver()
    if not driver or not edges:
        return
    payload = [
        {"before": before, "after": after, "confidence": confidence}
        for before, after, confidence in edges
    ]
    owner = current_user_id()
    cypher = """
    MERGE (d:Document {user_id: $owner, slug: $slug})
    WITH d
    UNWIND $edges AS edge
    MERGE (before:Concept {user_id: $owner, key: edge.before})
    MERGE (after:Concept {user_id: $owner, key: edge.after})
    MERGE (before)-[r:PREREQUISITE_OF]->(after)
    SET r.confidence = edge.confidence, r.source = 'llm'
    MERGE (d)-[:COVERS]->(before)
    MERGE (d)-[:COVERS]->(after)
    """
    try:
        with driver.session() as session:
            session.run(cypher, owner=owner, slug=doc_slug, edges=payload)
    except Exception:
        # SQLite 已是保底真相源，图服务异常不能阻断入库。
        return


def prerequisite_blockers(
    concept_labels: list[str],
    *,
    mastery_threshold: float = 0.6,
) -> list[dict[str, Any]]:
    """返回目标知识点尚未掌握的先修项，供 Planner 做拓扑约束。"""
    owner = current_user_id()
    target_keys = {concept_key_from_label(c) for c in concept_labels if c}
    if not target_keys:
        return []

    from app.models import ConceptMastery  # noqa: PLC0415

    with Session(engine) as session:
        all_edges = list(
            session.exec(
                select(KnowledgePrerequisite).where(
                    KnowledgePrerequisite.user_id == owner
                )
            )
        )
        mastery_rows = list(
            session.exec(
                select(ConceptMastery).where(ConceptMastery.user_id == owner)
            )
        )
    mastery = {row.concept_key: float(row.p_know) for row in mastery_rows}
    graph_edges = _neo4j_prerequisite_paths(owner=owner, target_keys=target_keys)
    if not graph_edges:
        graph_edges = _sqlite_prerequisite_paths(
            all_edges=all_edges,
            target_keys=target_keys,
        )

    blockers = []
    seen: set[tuple[str, str]] = set()
    for edge in graph_edges:
        prerequisite_key = str(edge["prerequisite_key"])
        concept_key = str(edge["concept_key"])
        pair = (prerequisite_key, concept_key)
        if pair in seen:
            continue
        seen.add(pair)
        probability = mastery.get(prerequisite_key, 0.0)
        if probability >= mastery_threshold:
            continue
        blockers.append(
            {
                "prerequisite_key": prerequisite_key,
                "concept_key": concept_key,
                "mastery_pct": round(probability * 100),
                "confidence": round(float(edge.get("confidence", 0.5)), 3),
                "depth": int(edge.get("depth", 1)),
                "source_wiki": str(edge.get("source_wiki", "")),
                "graph_source": str(edge.get("graph_source", "sqlite")),
            }
        )
    # 更深层的基础先修先学，再按掌握度与边置信度排序。
    blockers.sort(
        key=lambda item: (
            -item["depth"],
            item["mastery_pct"],
            -item["confidence"],
        )
    )
    return blockers


def _neo4j_prerequisite_paths(
    *,
    owner: str,
    target_keys: set[str],
) -> list[dict[str, Any]]:
    driver = get_driver()
    if not driver:
        return []
    cypher = """
    MATCH (target:Concept {user_id: $owner})
    WHERE target.key IN $targets
    MATCH path=(pre:Concept {user_id: $owner})-[:PREREQUISITE_OF*1..5]->(target)
    RETURN pre.key AS prerequisiteKey, target.key AS conceptKey,
           length(path) AS depth,
           reduce(score = 1.0, rel IN relationships(path) |
             score * coalesce(rel.confidence, 0.5)) AS confidence
    ORDER BY depth DESC, confidence DESC
    """
    try:
        with driver.session() as session:
            rows = session.run(
                cypher,
                owner=owner,
                targets=sorted(target_keys),
            )
            return [
                {
                    "prerequisite_key": row["prerequisiteKey"],
                    "concept_key": row["conceptKey"],
                    "depth": row["depth"],
                    "confidence": row["confidence"],
                    "graph_source": "neo4j",
                }
                for row in rows
                if row["prerequisiteKey"] and row["conceptKey"]
            ]
    except Exception:
        return []


def _sqlite_prerequisite_paths(
    *,
    all_edges: list[KnowledgePrerequisite],
    target_keys: set[str],
) -> list[dict[str, Any]]:
    reverse: dict[str, list[KnowledgePrerequisite]] = {}
    for edge in all_edges:
        reverse.setdefault(edge.concept_key, []).append(edge)
    paths: list[dict[str, Any]] = []

    def visit(
        current: str,
        target: str,
        *,
        depth: int,
        confidence: float,
        visited: set[str],
    ) -> None:
        if depth >= 5:
            return
        for edge in reverse.get(current, []):
            prerequisite = edge.prerequisite_key
            if prerequisite in visited:
                continue
            next_depth = depth + 1
            next_confidence = confidence * float(edge.confidence)
            paths.append(
                {
                    "prerequisite_key": prerequisite,
                    "concept_key": target,
                    "depth": next_depth,
                    "confidence": next_confidence,
                    "source_wiki": edge.source_wiki,
                    "graph_source": "sqlite",
                }
            )
            visit(
                prerequisite,
                target,
                depth=next_depth,
                confidence=next_confidence,
                visited=visited | {prerequisite},
            )

    for target in target_keys:
        visit(
            target,
            target,
            depth=0,
            confidence=1.0,
            visited={target},
        )
    return paths
