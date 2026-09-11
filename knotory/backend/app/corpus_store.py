"""语料库存储：本地目录或 S3 兼容对象存储（R2 / MinIO / OSS / TOS）。"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path

from app.config import settings

logger = logging.getLogger("knotory.corpus_store")

RAW_DIR = "raw"
WIKI_DIR = "wiki"
OUTPUT_DIR = "outputs"
STANDARD_DIRS = (RAW_DIR, WIKI_DIR, OUTPUT_DIR)

_store: "CorpusStore | None" = None


class CorpusStore(ABC):
    backend: str

    @abstractmethod
    def ensure_ready(self) -> None:
        """启动时拉取远程数据到本地工作目录。"""

    @abstractmethod
    def flush(self) -> None:
        """关闭前将本地变更推送到远程。"""

    @abstractmethod
    def notify_written(self, path: Path) -> None:
        """本地文件写入后同步到远程。"""

    @abstractmethod
    def notify_deleted(self, path: Path) -> None:
        """本地文件删除后同步到远程。"""

    @abstractmethod
    def ensure_local(self, path: Path) -> Path:
        """读取前确保文件已在本地缓存。"""

    @abstractmethod
    def describe(self) -> dict:
        """健康检查与调试信息。"""


class LocalCorpusStore(CorpusStore):
    backend = "local"

    def __init__(self, root: Path) -> None:
        self._root = root

    def ensure_ready(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        for d in STANDARD_DIRS:
            (self._root / d).mkdir(parents=True, exist_ok=True)

    def flush(self) -> None:
        return

    def notify_written(self, path: Path) -> None:
        return

    def notify_deleted(self, path: Path) -> None:
        return

    def ensure_local(self, path: Path) -> Path:
        return path

    def describe(self) -> dict:
        return {"backend": self.backend, "root": str(self._root)}


class S3CorpusStore(CorpusStore):
    backend = "s3"

    def __init__(
        self,
        *,
        root: Path,
        bucket: str,
        prefix: str,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        region: str,
    ) -> None:
        import boto3  # noqa: PLC0415
        from botocore.config import Config  # noqa: PLC0415

        self._root = root
        self._bucket = bucket.strip()
        self._prefix = (prefix or "knotory").strip().strip("/") + "/"
        session = boto3.session.Session(
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
            region_name=region or None,
        )
        client_kwargs: dict = {"config": Config(signature_version="s3v4")}
        if endpoint_url.strip():
            client_kwargs["endpoint_url"] = endpoint_url.strip()
        self._client = session.client("s3", **client_kwargs)

    def _object_key(self, rel: str) -> str:
        return f"{self._prefix}{rel.lstrip('/')}"

    def _rel_from_path(self, path: Path) -> str | None:
        try:
            return path.resolve().relative_to(self._root.resolve()).as_posix()
        except ValueError:
            return None

    def ensure_ready(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        for d in STANDARD_DIRS:
            (self._root / d).mkdir(parents=True, exist_ok=True)
        self._sync_from_remote()
        self._sync_db_from_remote()

    def flush(self) -> None:
        self._sync_to_remote()
        self._sync_db_to_remote()

    def notify_written(self, path: Path) -> None:
        rel = self._rel_from_path(path)
        if not rel or not path.is_file():
            return
        try:
            self._client.upload_file(str(path), self._bucket, self._object_key(rel))
        except Exception as exc:  # noqa: BLE001
            logger.warning("S3 upload failed for %s: %s", rel, exc)

    def notify_deleted(self, path: Path) -> None:
        rel = self._rel_from_path(path)
        if not rel:
            return
        try:
            self._client.delete_object(Bucket=self._bucket, Key=self._object_key(rel))
        except Exception as exc:  # noqa: BLE001
            logger.warning("S3 delete failed for %s: %s", rel, exc)

    def ensure_local(self, path: Path) -> Path:
        if path.is_file():
            return path
        rel = self._rel_from_path(path)
        if not rel:
            return path
        key = self._object_key(rel)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._client.download_file(self._bucket, key, str(path))
        except Exception:  # noqa: BLE001
            pass
        return path

    def describe(self) -> dict:
        return {
            "backend": self.backend,
            "bucket": self._bucket,
            "prefix": self._prefix.rstrip("/"),
            "cache_root": str(self._root),
            "endpoint": settings.s3_endpoint_url or "(aws default)",
        }

    def _sync_from_remote(self) -> None:
        paginator = self._client.get_paginator("list_objects_v2")
        count = 0
        for page in paginator.paginate(Bucket=self._bucket, Prefix=self._prefix):
            for obj in page.get("Contents") or []:
                key = obj.get("Key") or ""
                if not key or key == self._prefix or key.endswith("/"):
                    continue
                rel = key[len(self._prefix) :]
                if not rel or rel == "knotory.db":
                    continue
                local = self._root / rel
                local.parent.mkdir(parents=True, exist_ok=True)
                try:
                    self._client.download_file(self._bucket, key, str(local))
                    count += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("S3 download failed %s: %s", rel, exc)
        logger.info("S3 corpus sync: pulled %d objects into %s", count, self._root)

    def _sync_to_remote(self) -> None:
        if not self._root.is_dir():
            return
        count = 0
        for path in sorted(self._root.rglob("*")):
            if not path.is_file():
                continue
            rel = self._rel_from_path(path)
            if not rel:
                continue
            try:
                self._client.upload_file(str(path), self._bucket, self._object_key(rel))
                count += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("S3 upload failed %s: %s", rel, exc)
        logger.info("S3 corpus sync: pushed %d objects from %s", count, self._root)

    def _db_object_key(self) -> str:
        return self._object_key("knotory.db")

    def _sync_db_from_remote(self) -> None:
        db_path = settings.resolved_db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._client.download_file(self._bucket, self._db_object_key(), str(db_path))
            logger.info("S3 database pulled to %s", db_path)
        except Exception as exc:  # noqa: BLE001
            logger.info("S3 database pull skipped (may be first run): %s", exc)

    def _sync_db_to_remote(self) -> None:
        db_path = settings.resolved_db_path
        if not db_path.is_file():
            return
        try:
            self._client.upload_file(str(db_path), self._bucket, self._db_object_key())
            logger.info("S3 database pushed from %s", db_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("S3 database push failed: %s", exc)


def _build_store() -> CorpusStore:
    root = settings.resolved_data_dir
    if settings.resolved_storage_backend != "s3":
        return LocalCorpusStore(root)
    bucket = (settings.s3_bucket or "").strip()
    if not bucket:
        logger.warning("KNOTORY_STORAGE_BACKEND=s3 但未配置 S3_BUCKET，回退到本地目录存储")
        return LocalCorpusStore(root)
    return S3CorpusStore(
        root=root,
        bucket=bucket,
        prefix=settings.s3_prefix,
        endpoint_url=settings.s3_endpoint_url,
        access_key=settings.s3_access_key_id,
        secret_key=settings.s3_secret_access_key,
        region=settings.s3_region,
    )


def get_corpus_store() -> CorpusStore:
    global _store  # noqa: PLW0603
    if _store is None:
        _store = _build_store()
    return _store


def reset_corpus_store() -> None:
    """测试用：重建存储单例。"""
    global _store  # noqa: PLW0603
    _store = None


def init_corpus_store() -> None:
    get_corpus_store().ensure_ready()


def shutdown_corpus_store() -> None:
    get_corpus_store().flush()


def notify_path_written(path: Path) -> None:
    get_corpus_store().notify_written(path)


def notify_path_deleted(path: Path) -> None:
    get_corpus_store().notify_deleted(path)


def ensure_local_path(path: Path) -> Path:
    return get_corpus_store().ensure_local(path)


def storage_info() -> dict:
    return get_corpus_store().describe()


def sync_database_if_cloud() -> None:
    """S3 模式下将 SQLite 增量推送到云端（供定时任务或关键写操作后调用）。"""
    store = get_corpus_store()
    if isinstance(store, S3CorpusStore):
        store._sync_db_to_remote()  # noqa: SLF001
