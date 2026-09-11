from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _knotory_env_files() -> tuple[Path, ...]:
    """
    按顺序加载多个 .env，后者覆盖前者（pydantic-settings 行为）。

    除 `backend/.env` 与 `knotory/.env` 外，从 knotory 包目录的父级起向上遍历若干层，
    把路径上每一层的 `.env` 都纳入；避免写死 `parents[3]`——在 `apps/foo/knotory/backend`
    等嵌套布局下原先会指到错误目录，导致根目录的 ARK_API_KEY 等未加载、解析入库直接 503。
    """
    here = Path(__file__).resolve()
    backend_dir = here.parents[1]
    knotory_pkg = here.parents[2]
    ordered: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path) -> None:
        if not path.is_file():
            return
        key = path.resolve()
        if key in seen:
            return
        seen.add(key)
        ordered.append(key)

    add(backend_dir / ".env")
    add(knotory_pkg / ".env")
    cur = knotory_pkg.parent
    for _ in range(8):
        if cur == cur.parent:
            break
        add(cur / ".env")
        cur = cur.parent
    return tuple(ordered)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_knotory_env_files() or (".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 语料存储：s3 为默认（对象存储为真相源，本地 cache 为工作副本）；local 仅用于离线开发
    storage_backend: str = Field(default="s3", alias="KNOTORY_STORAGE_BACKEND")
    data_dir: str = Field(default="~/knotory-data", alias="KNOTORY_DATA_DIR")
    cache_dir: str = Field(
        default="/tmp/knotory-cache",
        alias="KNOTORY_CACHE_DIR",
        description="S3 模式下本地工作目录（读写缓存，启动时从云端拉取）",
    )
    db_path: str = Field(
        default="",
        alias="KNOTORY_DB_PATH",
        description="SQLite 路径；留空则使用数据目录下的 knotory.db",
    )
    s3_endpoint_url: str = Field(default="", alias="KNOTORY_S3_ENDPOINT_URL")
    s3_bucket: str = Field(default="", alias="KNOTORY_S3_BUCKET")
    s3_prefix: str = Field(default="knotory", alias="KNOTORY_S3_PREFIX")
    s3_access_key_id: str = Field(default="", alias="KNOTORY_S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(default="", alias="KNOTORY_S3_SECRET_ACCESS_KEY")
    s3_region: str = Field(default="auto", alias="KNOTORY_S3_REGION")
    cloud_api_key: str | None = Field(default=None, alias="KNOTORY_CLOUD_API_KEY")
    cloud_base_url: str | None = Field(default=None, alias="KNOTORY_CLOUD_BASE_URL")
    cloud_model: str = Field(default="gpt-4o-mini", alias="KNOTORY_CLOUD_MODEL")
    # 火山方舟豆包多模态（与 monorepo 中 vault/hk 一致，可读 ARK_* / DOUBAO_*）
    ark_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KNOTORY_ARK_API_KEY", "ARK_API_KEY", "DOUBAO_API_KEY"),
    )
    ark_api_base: str = Field(
        default="https://ark.cn-beijing.volces.com/api/v3",
        validation_alias=AliasChoices("KNOTORY_ARK_API_BASE", "DOUBAO_API_BASE", "ARK_API_BASE"),
    )
    ark_vision_model: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "KNOTORY_ARK_VISION_MODEL",
            "ARK_VISION_MODEL",
            "ARK_MODEL",
            "DOUBAO_MODEL",
        ),
    )
    # 方舟「纯文本」摘要/标签用接入点；未设置时与 ark_vision_model（多模态）相同。
    ark_text_model: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "KNOTORY_ARK_TEXT_MODEL",
            "ARK_TEXT_MODEL",
            "DOUBAO_TEXT_MODEL",
        ),
    )
    log_level: str = Field(default="INFO", alias="KNOTORY_LOG_LEVEL")
    neo4j_uri: str = Field(default="", alias="KNOTORY_NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="KNOTORY_NEO4J_USER")
    neo4j_password: str = Field(default="", alias="KNOTORY_NEO4J_PASSWORD")
    ocr_enabled: bool = Field(default=True, alias="KNOTORY_OCR_ENABLED")
    pdf_ocr_min_chars: int = Field(default=40, alias="KNOTORY_PDF_OCR_MIN_CHARS")

    companion_scheduler_enabled: bool = Field(default=True, alias="KNOTORY_COMPANION_CRON_ENABLED")
    companion_cron_hour: int = Field(default=3, alias="KNOTORY_COMPANION_CRON_HOUR")
    companion_cron_minute: int = Field(default=15, alias="KNOTORY_COMPANION_CRON_MINUTE")
    companion_cron_timezone: str = Field(default="Asia/Shanghai", alias="KNOTORY_COMPANION_CRON_TZ")
    companion_llm_timeout_sec: float = Field(default=120.0, alias="KNOTORY_COMPANION_LLM_TIMEOUT_SEC")
    companion_parallel_sections: int = Field(default=1, alias="KNOTORY_COMPANION_PARALLEL")

    backup_scheduler_enabled: bool = Field(default=False, alias="KNOTORY_BACKUP_CRON_ENABLED")
    backup_cron_hour: int = Field(default=4, alias="KNOTORY_BACKUP_CRON_HOUR")
    backup_cron_minute: int = Field(default=0, alias="KNOTORY_BACKUP_CRON_MINUTE")

    watch_scheduler_enabled: bool = Field(default=False, alias="KNOTORY_WATCH_CRON_ENABLED")
    watch_cron_hour: int = Field(default=5, alias="KNOTORY_WATCH_CRON_HOUR")
    watch_cron_minute: int = Field(default=30, alias="KNOTORY_WATCH_CRON_MINUTE")

    # —— 公网 / 生产部署 ——
    api_key: str | None = Field(
        default=None,
        alias="KNOTORY_API_KEY",
        description="设置后，除 /health 与文档外所有 API 需 Bearer 鉴权",
    )
    cors_origins: str = Field(
        default="*",
        alias="KNOTORY_CORS_ORIGINS",
        description="逗号分隔的允许来源；生产请设为前端域名",
    )
    max_upload_bytes: int = Field(
        default=32 * 1024 * 1024,
        alias="KNOTORY_MAX_UPLOAD_BYTES",
    )
    upload_rate_limit_per_minute: int = Field(
        default=12,
        alias="KNOTORY_UPLOAD_RATE_LIMIT_PER_MIN",
    )
    trusted_hosts: str = Field(
        default="",
        alias="KNOTORY_TRUSTED_HOSTS",
        description="逗号分隔 Host 白名单；空则不过滤",
    )
    disable_openapi: bool = Field(
        default=False,
        alias="KNOTORY_DISABLE_OPENAPI",
        description="生产设为 true 时关闭 /docs 与 /openapi.json",
    )
    cloud_demo_public_url: str = Field(
        default="",
        alias="KNOTORY_CLOUD_DEMO_URL",
        description="对外公布的云端试用 URL，写入 /health 供自托管实例引导用户",
    )
    is_cloud_demo: bool = Field(
        default=False,
        alias="KNOTORY_IS_CLOUD_DEMO",
        description="当前实例是否为官方云端试用部署",
    )
    auth_required: bool = Field(
        default=False,
        alias="KNOTORY_AUTH_REQUIRED",
        description="为 true 时 API 需用户 JWT（Cloud 多租户）",
    )
    jwt_secret: str = Field(
        default="change-me-in-production-knotory-jwt",
        alias="KNOTORY_JWT_SECRET",
    )
    jwt_expire_hours: int = Field(default=168, alias="KNOTORY_JWT_EXPIRE_HOURS", ge=1, le=720)
    waitlist_rate_limit_per_minute: int = Field(
        default=8,
        alias="KNOTORY_WAITLIST_RATE_LIMIT_PER_MIN",
    )

    # —— 问答闪卡（LLM） ——
    flashcard_llm_enabled: bool = Field(default=True, alias="KNOTORY_FLASHCARD_LLM_ENABLED")
    flashcard_qa_per_section: int = Field(default=2, alias="KNOTORY_FLASHCARD_QA_PER_SECTION")
    flashcard_min_cards_per_wiki: int = Field(
        default=20,
        alias="KNOTORY_FLASHCARD_MIN_CARDS_PER_WIKI",
        description="单篇资料拆卡目标下限（通过更细分块达成）",
    )
    flashcard_section_min_chars: int = Field(
        default=900,
        alias="KNOTORY_FLASHCARD_SECTION_MIN_CHARS",
        description="闪卡分块时，单块正文最少字符数（不足则与相邻块合并；大文档会自动降低）",
    )
    flashcard_section_max_heading_level: int = Field(
        default=1,
        alias="KNOTORY_FLASHCARD_SECTION_MAX_LEVEL",
        description="短文档默认仅在 h1 切分；大文档会自动放宽到 h2",
    )
    flashcard_max_sections_per_wiki: int = Field(
        default=150,
        alias="KNOTORY_FLASHCARD_MAX_SECTIONS_PER_WIKI",
        description="单篇 wiki 最多生成的闪卡块数，0 表示不限制",
    )
    flashcard_large_doc_chars: int = Field(
        default=25_000,
        alias="KNOTORY_FLASHCARD_LARGE_DOC_CHARS",
        description="正文超过此字数时启用大文档策略（纯文本章标题、h2、按段切分）",
    )
    flashcard_target_chars_per_card: int = Field(
        default=1500,
        alias="KNOTORY_FLASHCARD_TARGET_CHARS_PER_CARD",
        description="大文档无标题时，每块目标字数（用于凑满目标闪卡数）",
    )
    flashcard_llm_max_sections_per_sync: int = Field(
        default=120,
        alias="KNOTORY_FLASHCARD_LLM_MAX_SECTIONS",
    )
    flashcard_llm_parallel_workers: int = Field(
        default=4,
        alias="KNOTORY_FLASHCARD_LLM_PARALLEL",
        description="单次 sync 并发 LLM 出题线程数",
    )
    flashcard_feed_candidate_pool: int = Field(
        default=240,
        alias="KNOTORY_FLASHCARD_FEED_POOL",
        description="推荐流排序候选池大小（SQL 随机抽样）",
    )
    flashcard_section_input_chars: int = Field(
        default=6000,
        alias="KNOTORY_FLASHCARD_SECTION_CHARS",
    )
    flashcard_image_enabled: bool = Field(default=True, alias="KNOTORY_FLASHCARD_IMAGE_ENABLED")
    flashcard_image_max_per_sync: int = Field(
        default=10,
        alias="KNOTORY_FLASHCARD_IMAGE_MAX_PER_SYNC",
    )
    flashcard_image_size: str = Field(default="2K", alias="KNOTORY_FLASHCARD_IMAGE_SIZE")
    flashcard_image_timeout_sec: float = Field(default=120.0, alias="KNOTORY_FLASHCARD_IMAGE_TIMEOUT_SEC")
    flashcard_image_on_sync_max: int = Field(
        default=10,
        alias="KNOTORY_FLASHCARD_IMAGE_ON_SYNC_MAX",
        description="每次 sync 最多生成配图张数",
    )
    ingest_fast_return: bool = Field(
        default=True,
        alias="KNOTORY_INGEST_FAST_RETURN",
        description="上传快速返回，摘要/wiki/拆卡在后台完成",
    )

    # —— 长期记忆 / 向量 RAG / Agent ——
    vector_backend: str = Field(
        default="local",
        alias="KNOTORY_VECTOR_BACKEND",
        description="local（SQLite）| milvus",
    )
    milvus_uri: str = Field(default="", alias="KNOTORY_MILVUS_URI")
    milvus_collection: str = Field(default="knotory_chunks", alias="KNOTORY_MILVUS_COLLECTION")
    embedding_model: str = Field(
        default="",
        alias="KNOTORY_EMBEDDING_MODEL",
        description="方舟/云端 embedding 模型名；空则用本地哈希向量",
    )
    embedding_dim: int = Field(default=384, alias="KNOTORY_EMBEDDING_DIM", ge=64, le=4096)
    hybrid_vector_weight: float = Field(
        default=0.55,
        alias="KNOTORY_HYBRID_VECTOR_WEIGHT",
        description="Hybrid 检索中向量分权重（其余为关键词）",
    )
    learning_agent_enabled: bool = Field(
        default=True,
        alias="KNOTORY_LEARNING_AGENT_ENABLED",
        description="学习路径是否走 Planner-Executor-Memory-Reflector 闭环",
    )
    dkt_enabled: bool = Field(default=True, alias="KNOTORY_DKT_ENABLED")
    dkt_skill_buckets: int = Field(
        default=256, alias="KNOTORY_DKT_SKILL_BUCKETS", ge=64, le=4096
    )
    dkt_hidden_size: int = Field(
        default=48, alias="KNOTORY_DKT_HIDDEN_SIZE", ge=16, le=256
    )
    dkt_sequence_length: int = Field(
        default=256, alias="KNOTORY_DKT_SEQUENCE_LENGTH", ge=16, le=2048
    )
    dkt_online_epochs: int = Field(
        default=3, alias="KNOTORY_DKT_ONLINE_EPOCHS", ge=1, le=8
    )
    watch_dir: str | None = Field(
        default=None,
        alias="KNOTORY_WATCH_DIR",
        description="监视目录：调用 watch/scan 时导入新文件",
    )
    ark_image_model: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "KNOTORY_ARK_IMAGE_MODEL",
            "ARK_IMAGE_MODEL",
            "DOUBAO_IMAGE_MODEL",
        ),
    )

    @property
    def resolved_storage_backend(self) -> str:
        return (self.storage_backend or "s3").strip().lower()

    @property
    def resolved_data_dir(self) -> Path:
        if self.resolved_storage_backend == "s3":
            return Path(self.cache_dir).expanduser().resolve()
        return Path(self.data_dir).expanduser().resolve()

    @property
    def resolved_db_path(self) -> Path:
        raw = (self.db_path or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
        return self.resolved_data_dir / "knotory.db"

    @property
    def resolved_ark_api_key(self) -> str | None:
        if not self.ark_api_key:
            return None
        key = str(self.ark_api_key).strip()
        return key or None

    @property
    def resolved_ark_chat_completions_url(self) -> str:
        return f"{self.ark_api_base.rstrip('/')}/chat/completions"

    @property
    def resolved_ark_vision_model(self) -> str:
        m = (self.ark_vision_model or "").strip()
        return m or "doubao-seed-2-0-pro-260215"

    @property
    def resolved_ark_text_model(self) -> str:
        m = (self.ark_text_model or "").strip()
        return m or self.resolved_ark_vision_model

    @property
    def resolved_ark_image_model(self) -> str | None:
        m = (self.ark_image_model or "").strip()
        return m or None

    @property
    def resolved_cloud_api_key(self) -> str | None:
        k = (self.cloud_api_key or "").strip()
        return k or None

    @property
    def resolved_cors_origins(self) -> list[str]:
        raw = (self.cors_origins or "*").strip()
        if raw == "*":
            return ["*"]
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        return parts or ["*"]

    @property
    def resolved_trusted_hosts(self) -> list[str]:
        return [h.strip() for h in (self.trusted_hosts or "").split(",") if h.strip()]


settings = Settings()
