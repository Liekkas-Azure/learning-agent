"""语料云存储抽象层单测。"""

from pathlib import Path

import pytest

from app.corpus_store import LocalCorpusStore, _build_store, notify_path_written, reset_corpus_store
from app.config import settings


@pytest.fixture(autouse=True)
def _local_storage(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOTORY_STORAGE_BACKEND", "local")
    monkeypatch.setenv("KNOTORY_DATA_DIR", str(tmp_path / "data"))
    reset_corpus_store()
    # 重载 settings 单例字段
    monkeypatch.setattr(settings, "storage_backend", "local")
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
    monkeypatch.setattr(settings, "s3_bucket", "")
    yield
    reset_corpus_store()


def test_local_store_write_and_read(tmp_path: Path):
    root = tmp_path / "data"
    store = LocalCorpusStore(root)
    store.ensure_ready()
    wiki = root / "wiki" / "demo.md"
    wiki.parent.mkdir(parents=True, exist_ok=True)
    wiki.write_text("# demo", encoding="utf-8")
    notify_path_written(wiki)
    assert wiki.read_text(encoding="utf-8") == "# demo"


def test_s3_without_bucket_falls_back_to_local(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOTORY_STORAGE_BACKEND", "s3")
    monkeypatch.setattr(settings, "storage_backend", "s3")
    monkeypatch.setattr(settings, "s3_bucket", "")
    monkeypatch.setattr(settings, "cache_dir", str(tmp_path / "cache"))
    reset_corpus_store()
    store = _build_store()
    assert store.backend == "local"
