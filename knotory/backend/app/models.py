from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    """云端多租户用户。"""

    id: str = Field(primary_key=True, max_length=36)
    email: str = Field(index=True, unique=True, max_length=320)
    password_hash: str = Field(default="", max_length=256)
    display_name: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class IngestRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    file_name: str
    source_path: str
    status: str = "ok"
    summary: str = ""
    tags_csv: str = ""
    contradictions_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ContentCache(SQLModel, table=True):
    """Incremental dedup: same file bytes -> skip full re-compile."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    content_sha256: str = Field(index=True)
    file_name: str
    base_name: str
    ingest_record_id: int | None = None
    output_json: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class KnowledgeFlashcard(SQLModel, table=True):
    """从语料章节/摘要生成的知识闪卡，供推荐流消费。"""

    __table_args__ = (UniqueConstraint("content_key", name="uq_flashcard_content_key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    content_key: str = Field(index=True)
    card_kind: str = "section"  # section | summary | companion
    wiki_file_name: str = Field(default="", index=True)
    section_id: str = ""
    topic: str = Field(default="未分类", index=True)
    topics_csv: str = ""
    front_text: str = ""
    back_text: str = ""
    source_title: str = ""
    visual_mermaid: str = ""
    visual_caption: str = ""
    visual_palette: str = ""
    visual_emoji: str = ""
    visual_image_path: str = ""
    image_prompt: str = ""
    quality_score: float = Field(default=1.0)
    quality_flags: str = Field(default="")
    source_anchor: str = Field(default="")
    generation_meta: str = Field(default="")
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FlashcardReviewState(SQLModel, table=True):
    """间隔重复（SM-2 简化）状态，每张活跃卡一条。"""

    flashcard_id: int = Field(primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    ease_factor: float = Field(default=2.5)
    interval_days: int = Field(default=0)
    repetitions: int = Field(default=0)
    next_review_at: datetime = Field(default_factory=datetime.utcnow)
    last_reviewed_at: datetime | None = None


class FlashcardUserNote(SQLModel, table=True):
    """闪卡笔记（服务端同步，按用户+卡唯一）。"""

    flashcard_id: int = Field(primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    text: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WaitlistEmail(SQLModel, table=True):
    """C 端早鸟 / Cloud 意向邮箱（服务端持久化）。"""

    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    source: str = Field(default="welcome", max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class KnowledgeClip(SQLModel, table=True):
    """网页/选段剪藏入库。"""

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    text: str = ""
    source_title: str = ""
    source_url: str = ""
    wiki_file_name: str = Field(default="", index=True)
    section_id: str = ""
    tags_csv: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FlashcardFeedback(SQLModel, table=True):
    """用户对闪卡的反馈，用于迭代推荐权重。"""

    id: int | None = Field(default=None, primary_key=True)
    flashcard_id: int = Field(index=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    action: str = Field(index=True)  # like | dislike | skip | save | open_source | bad_card | flip
    dwell_ms: int = 0
    session_id: str = Field(default="default", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReadingCompanionCache(SQLModel, table=True):
    """伴读：按 wiki 章节缓存大模型输出；入库后台预生成 + 定时按输入指纹刷新。"""

    __table_args__ = (UniqueConstraint("wiki_file_name", "section_id", name="uq_rc_wiki_section"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    wiki_file_name: str = Field(index=True)
    section_id: str = Field(index=True)
    section_title: str = ""
    companion_markdown: str = ""
    provider: str = ""
    status: str = "pending"  # pending | ok | error
    error_message: str = ""
    inputs_sha256: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ConceptMastery(SQLModel, table=True):
    """概念级 BKT 掌握度（Student State 原子）。"""

    __table_args__ = (UniqueConstraint("user_id", "concept_key", name="uq_concept_mastery_user_key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    concept_key: str = Field(index=True, max_length=256)
    concept_label: str = Field(default="", max_length=256)
    p_know: float = Field(default=0.2)
    observations: int = Field(default=0)
    last_correct: bool | None = None
    bkt_probability: float = Field(default=0.2)
    dkt_probability: float = Field(default=0.2)
    dkt_model: str = Field(default="", max_length=64)
    dkt_sequence_length: int = Field(default=0)
    dkt_loss: float | None = None
    confidence: float = Field(default=0.0)
    error_patterns_json: str = Field(default="[]")
    source_wiki: str = Field(default="", max_length=512)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StudentObservation(SQLModel, table=True):
    """答题、行为、文本诊断等多源时序事件，供 BKT/DKT 状态估计。"""

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    concept_key: str = Field(index=True, max_length=256)
    source: str = Field(default="review", index=True, max_length=64)
    correct: bool | None = None
    semantic_score: float | None = None
    dwell_ms: int = Field(default=0)
    action: str = Field(default="", max_length=64)
    evidence_weight: float = Field(default=1.0)
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class UserLearningProfile(SQLModel, table=True):
    """从行为与历史交互持续更新的用户画像。"""

    user_id: str = Field(primary_key=True, max_length=36)
    preferred_actions_json: str = Field(default="{}")
    preferred_topics_json: str = Field(default="{}")
    average_dwell_ms: float = Field(default=0.0)
    total_events: int = Field(default=0)
    state_summary: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class KnowledgePrerequisite(SQLModel, table=True):
    """知识点先修关系；Neo4j 不可用时由 SQLite 保底。"""

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "prerequisite_key",
            "concept_key",
            name="uq_prerequisite_user_edge",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    prerequisite_key: str = Field(index=True, max_length=256)
    concept_key: str = Field(index=True, max_length=256)
    confidence: float = Field(default=0.5)
    source: str = Field(default="llm", max_length=64)
    source_wiki: str = Field(default="", max_length=512)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MemoryEpisode(SQLModel, table=True):
    """反思后写回的高价值交互经验（长期记忆条目）。"""

    __table_args__ = (
        UniqueConstraint("user_id", "memory_key", name="uq_memory_episode_user_key"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    memory_key: str = Field(default="", index=True, max_length=64)
    kind: str = Field(default="reflection", index=True, max_length=64)
    title: str = Field(default="", max_length=256)
    body: str = ""
    concepts_csv: str = ""
    value_score: float = Field(default=0.5)
    wiki_file_name: str = Field(default="", max_length=512)
    source_event: str = Field(default="", max_length=128)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VectorChunk(SQLModel, table=True):
    """本地向量块（Milvus 不可用时的 SQLite 回退）。"""

    __table_args__ = (UniqueConstraint("user_id", "chunk_key", name="uq_vector_chunk_user_key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    chunk_key: str = Field(index=True, max_length=320)
    source_kind: str = Field(default="wiki", max_length=64)
    source_ref: str = Field(default="", max_length=512)
    title: str = Field(default="", max_length=512)
    text: str = ""
    embedding_json: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BanditArmStat(SQLModel, table=True):
    """Contextual Bandit：教学 Action 臂的奖励统计。"""

    __table_args__ = (UniqueConstraint("user_id", "arm_key", name="uq_bandit_arm_user_key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(default="__default__", index=True, max_length=36)
    arm_key: str = Field(index=True, max_length=128)
    pulls: int = Field(default=0)
    reward_sum: float = Field(default=0.0)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
