from pathlib import Path

from app.corpus_export import MANIFEST_VERSION, build_corpus_manifest


def test_build_corpus_manifest_empty(tmp_path, monkeypatch):
    monkeypatch.setattr("app.corpus_export.settings.data_dir", str(tmp_path))
    (tmp_path / "wiki").mkdir()
    (tmp_path / "raw").mkdir()
    (tmp_path / "outputs").mkdir()
    m = build_corpus_manifest()
    assert m["manifest_version"] == MANIFEST_VERSION
    assert m["documents"] == []
    assert "layout" in m
