import logging
from typing import Any

from app.config import settings
from app.graph_enrich import enrich_knotory_graph
from app.tenant import current_user_id

logger = logging.getLogger("knotory.neo4j")

_driver: Any = None
_driver_failed = False


def get_driver() -> Any:
    global _driver, _driver_failed
    if _driver_failed:
        return None
    if not settings.neo4j_uri or not settings.neo4j_password:
        return None
    if _driver is not None:
        return _driver
    try:
        from neo4j import GraphDatabase  # noqa: PLC0415

        drv = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        drv.verify_connectivity()
        _driver = drv
        logger.info("Neo4j connected: %s", settings.neo4j_uri)
        return _driver
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j unavailable (%s); graph sync skipped.", exc)
        _driver_failed = True
        return None


def close_driver() -> None:
    global _driver, _driver_failed
    if _driver is not None:
        try:
            _driver.close()
        except Exception:  # noqa: BLE001
            pass
    _driver = None
    _driver_failed = False


def sync_document(slug: str, title: str, summary: str, tags: list[str]) -> None:
    drv = get_driver()
    if not drv:
        return
    tags = [t for t in tags if t.strip()]
    owner = current_user_id()
    cypher = """
    MERGE (d:Document {user_id: $owner, slug: $slug})
    SET d.title = $title, d.summary = $summary
    WITH d
    OPTIONAL MATCH (d)-[r:TAGGED]->(:Tag)
    DELETE r
    WITH d
    UNWIND $tags AS tagName
    MERGE (t:Tag {user_id: $owner, name: tagName})
    MERGE (d)-[:TAGGED]->(t)
    """
    try:
        with drv.session() as session:
            session.run(
                cypher,
                slug=slug,
                owner=owner,
                title=title[:512],
                summary=(summary or "")[:4000],
                tags=tags,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j sync failed: %s", exc)


def sync_concepts(doc_slug: str, concepts: list[str]) -> None:
    """将概念节点挂到文档上，支撑 Planner 的知识图谱约束。"""
    drv = get_driver()
    if not drv:
        return
    names = [c.strip() for c in concepts if c and str(c).strip()][:40]
    if not names:
        return
    owner = current_user_id()
    cypher = """
    MERGE (d:Document {user_id: $owner, slug: $slug})
    WITH d
    UNWIND $concepts AS cname
    MERGE (c:Concept {user_id: $owner, key: toLower(cname)})
    SET c.name = cname
    MERGE (d)-[:COVERS]->(c)
    """
    try:
        with drv.session() as session:
            session.run(cypher, owner=owner, slug=doc_slug, concepts=names)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j concept sync failed: %s", exc)


def delete_document(slug: str) -> None:
    """从图中移除该册（与 sync_document 使用同一 slug）。"""
    drv = get_driver()
    if not drv:
        return
    owner = current_user_id()
    try:
        with drv.session() as session:
            session.run(
                "MATCH (d:Document {user_id: $owner, slug: $slug}) DETACH DELETE d",
                owner=owner,
                slug=slug,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j delete document failed: %s", exc)


def fetch_graph_payload() -> dict[str, Any] | None:
    drv = get_driver()
    if not drv:
        return None
    cypher = """
    MATCH (d:Document {user_id: $owner})
    OPTIONAL MATCH (d)-[:TAGGED]->(t:Tag {user_id: $owner})
    RETURN d.slug AS slug, d.title AS title, collect(DISTINCT t.name) AS tags
    """
    nodes: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    tag_ids: dict[str, str] = {}
    concept_ids: set[str] = set()
    owner = current_user_id()

    def tid(name: str) -> str:
        if name not in tag_ids:
            tag_ids[name] = f"tag:{name}"
        return tag_ids[name]

    try:
        with drv.session() as session:
            rows = session.run(cypher, owner=owner)
            for row in rows:
                slug = row["slug"]
                title = row["title"] or slug
                tags = [t for t in (row["tags"] or []) if t]
                doc_id = f"doc:{slug}"
                nodes.append({"id": doc_id, "label": title, "group": "document"})
                for tag in tags:
                    tid(tag)
                for tag in tags:
                    links.append({"source": doc_id, "target": tid(tag), "kind": "TAGGED"})
            concept_rows = session.run(
                """
                MATCH (d:Document {user_id: $owner})-[:COVERS]->(c:Concept {user_id: $owner})
                OPTIONAL MATCH (p:Concept {user_id: $owner})-[r:PREREQUISITE_OF]->(c)
                RETURN d.slug AS slug, c.key AS conceptKey, c.name AS conceptName,
                       collect(DISTINCT {
                         key: p.key, name: p.name, confidence: r.confidence
                       }) AS prerequisites
                """,
                owner=owner,
            )
            for row in concept_rows:
                concept_key = row["conceptKey"] or row["conceptName"]
                if not concept_key:
                    continue
                concept_id = f"concept:{concept_key}"
                if concept_id not in concept_ids:
                    concept_ids.add(concept_id)
                    nodes.append(
                        {
                            "id": concept_id,
                            "label": row["conceptName"] or concept_key,
                            "group": "concept",
                        }
                    )
                links.append(
                    {
                        "source": f"doc:{row['slug']}",
                        "target": concept_id,
                        "kind": "COVERS",
                    }
                )
                for prereq in row["prerequisites"] or []:
                    prereq_key = prereq.get("key") or prereq.get("name")
                    if not prereq_key:
                        continue
                    prereq_id = f"concept:{prereq_key}"
                    if prereq_id not in concept_ids:
                        concept_ids.add(prereq_id)
                        nodes.append(
                            {
                                "id": prereq_id,
                                "label": prereq.get("name") or prereq_key,
                                "group": "concept",
                            }
                        )
                    links.append(
                        {
                            "source": prereq_id,
                            "target": concept_id,
                            "kind": "PREREQUISITE_OF",
                            "confidence": prereq.get("confidence") or 0.5,
                        }
                    )
        for name, tid_str in tag_ids.items():
            nodes.append({"id": tid_str, "label": name, "group": "tag"})
        return enrich_knotory_graph({"nodes": nodes, "links": links, "source": "neo4j"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j graph read failed: %s", exc)
        return None


def fetch_graph_sqlite_fallback(limit: int = 80) -> dict[str, Any]:
    """Works without Neo4j: Document nodes from ingest history + Tag nodes."""
    from app.storage import list_records  # noqa: PLC0415

    records = list_records(limit=limit)
    nodes: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    tag_ids: dict[str, str] = {}

    def tid(name: str) -> str:
        if name not in tag_ids:
            tag_ids[name] = f"tag:{name}"
        return tag_ids[name]

    for rec in records:
        if not rec.id:
            continue
        doc_id = f"doc:{rec.id}"
        title = rec.file_name or f"record-{rec.id}"
        nodes.append({"id": doc_id, "label": title, "group": "document"})
        tags = [t.strip() for t in (rec.tags_csv or "").split(",") if t.strip()]
        for tag in tags:
            tid(tag)
        for tag in tags:
            links.append({"source": doc_id, "target": tid(tag), "kind": "TAGGED"})
    for name, tid_str in tag_ids.items():
        nodes.append({"id": tid_str, "label": name, "group": "tag"})
    try:
        from sqlmodel import Session, select  # noqa: PLC0415

        from app.models import KnowledgePrerequisite  # noqa: PLC0415
        from app.storage import engine  # noqa: PLC0415
        from app.tenant import current_user_id  # noqa: PLC0415

        with Session(engine) as session:
            edges = list(
                session.exec(
                    select(KnowledgePrerequisite)
                    .where(KnowledgePrerequisite.user_id == current_user_id())
                    .limit(limit * 3)
                )
            )
        concept_ids: set[str] = set()
        for edge in edges:
            before = f"concept:{edge.prerequisite_key}"
            after = f"concept:{edge.concept_key}"
            for node_id, label in (
                (before, edge.prerequisite_key),
                (after, edge.concept_key),
            ):
                if node_id not in concept_ids:
                    concept_ids.add(node_id)
                    nodes.append(
                        {"id": node_id, "label": label, "group": "concept"}
                    )
            links.append(
                {
                    "source": before,
                    "target": after,
                    "kind": "PREREQUISITE_OF",
                    "confidence": edge.confidence,
                }
            )
    except Exception:  # noqa: BLE001
        pass
    return enrich_knotory_graph({"nodes": nodes, "links": links, "source": "sqlite"})
