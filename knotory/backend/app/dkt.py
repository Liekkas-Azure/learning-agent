"""可训练的 Deep Knowledge Tracing（GRU）在线推理与增量训练。"""

from __future__ import annotations

import hashlib
import logging
import threading
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.config import settings
from app.models import StudentObservation
from app.paths import tenant_data_dir
from app.storage import engine
from app.tenant import current_user_id

logger = logging.getLogger("knotory.dkt")
_model_lock = threading.Lock()
_MODEL_VERSION = 1


def _skill_bucket(concept_key: str, buckets: int) -> int:
    digest = hashlib.sha256(concept_key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % buckets


def _model_path() -> Path:
    path = tenant_data_dir() / "models" / "dkt.pt"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load_sequence(limit: int) -> list[StudentObservation]:
    owner = current_user_id()
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(StudentObservation)
                .where(
                    StudentObservation.user_id == owner,
                    StudentObservation.correct.is_not(None),
                )
                .order_by(
                    StudentObservation.created_at.desc(),
                    StudentObservation.id.desc(),
                )
                .limit(limit)
            )
        )
    rows.reverse()
    return rows


def _torch_modules():
    try:
        import torch
        from torch import nn

        return torch, nn
    except ImportError as exc:
        raise RuntimeError(
            "DKT 需要 PyTorch；请安装 requirements.txt 中的 torch"
        ) from exc


def _build_model(*, buckets: int, hidden_size: int):
    torch, nn = _torch_modules()

    class HashedDKT(nn.Module):
        """标准 DKT 结构：技能×答题结果 token → Embedding → GRU → 下一技能正确率。"""

        def __init__(self) -> None:
            super().__init__()
            self.embedding = nn.Embedding(buckets * 2, 32)
            self.gru = nn.GRU(35, hidden_size, batch_first=True)
            self.output = nn.Linear(hidden_size, buckets)

        def forward(self, tokens, auxiliary):
            embedded = self.embedding(tokens)
            features = torch.cat((embedded, auxiliary), dim=-1)
            hidden, _ = self.gru(features)
            return self.output(hidden)

    return HashedDKT()


def _tensors(rows: list[StudentObservation], *, buckets: int):
    torch, _ = _torch_modules()
    skills = [_skill_bucket(row.concept_key, buckets) for row in rows]
    answers = [1 if row.correct else 0 for row in rows]
    tokens = [skill * 2 + answer for skill, answer in zip(skills, answers)]
    auxiliary = []
    for row, answer in zip(rows, answers):
        semantic = (
            float(row.semantic_score)
            if row.semantic_score is not None
            else float(answer)
        )
        dwell = min(max(int(row.dwell_ms), 0), 120_000) / 120_000.0
        weight = min(max(float(row.evidence_weight), 0.0), 2.0) / 2.0
        auxiliary.append([semantic, dwell, weight])
    return (
        torch.tensor([tokens], dtype=torch.long),
        torch.tensor([auxiliary], dtype=torch.float32),
        torch.tensor(skills, dtype=torch.long),
        torch.tensor(answers, dtype=torch.float32),
    )


def _load_weights(model, path: Path) -> bool:
    if not path.is_file():
        return False
    torch, _ = _torch_modules()
    try:
        try:
            payload = torch.load(path, map_location="cpu", weights_only=True)
        except TypeError:
            payload = torch.load(path, map_location="cpu")
        if int(payload.get("version", 0)) != _MODEL_VERSION:
            return False
        model.load_state_dict(payload["state_dict"])
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("DKT model load failed, rebuilding: %s", exc)
        return False


def _save_weights(model, path: Path, *, observations: int) -> None:
    torch, _ = _torch_modules()
    tmp = path.with_suffix(".tmp")
    torch.save(
        {
            "version": _MODEL_VERSION,
            "state_dict": model.state_dict(),
            "observations": observations,
        },
        tmp,
    )
    tmp.replace(path)
    try:
        from app.corpus_store import notify_path_written  # noqa: PLC0415

        notify_path_written(path)
    except Exception:  # noqa: BLE001
        pass


def train_and_predict(
    concept_key: str,
    *,
    train: bool = True,
) -> dict[str, Any] | None:
    """使用用户完整时序预测目标概念下一次答对概率，并在线微调模型。"""
    if not getattr(settings, "dkt_enabled", True):
        return None
    buckets = int(getattr(settings, "dkt_skill_buckets", 256))
    hidden_size = int(getattr(settings, "dkt_hidden_size", 48))
    sequence_limit = int(getattr(settings, "dkt_sequence_length", 256))
    epochs = int(getattr(settings, "dkt_online_epochs", 3))
    rows = _load_sequence(sequence_limit)
    if len(rows) < 3:
        return None

    with _model_lock:
        torch, nn = _torch_modules()
        seed = int.from_bytes(
            hashlib.sha256(current_user_id().encode("utf-8")).digest()[:4],
            "big",
        )
        torch.manual_seed(seed)
        model = _build_model(buckets=buckets, hidden_size=hidden_size)
        path = _model_path()
        loaded = _load_weights(model, path)
        tokens, auxiliary, skills, answers = _tensors(rows, buckets=buckets)

        loss_value: float | None = None
        if train and len(rows) >= 4:
            model.train()
            optimizer = torch.optim.Adam(model.parameters(), lr=0.006)
            criterion = nn.BCEWithLogitsLoss()
            # t 的交互预测 t+1 对应技能的正确率，这是标准 DKT 训练目标。
            for _ in range(max(1, min(8, epochs))):
                optimizer.zero_grad()
                logits = model(tokens[:, :-1], auxiliary[:, :-1])
                next_skills = skills[1:].view(1, -1, 1)
                selected = logits.gather(2, next_skills).squeeze(-1)
                loss = criterion(selected, answers[1:].view(1, -1))
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                optimizer.step()
                loss_value = float(loss.detach().item())
            _save_weights(model, path, observations=len(rows))

        model.eval()
        with torch.no_grad():
            logits = model(tokens, auxiliary)
            target = _skill_bucket(concept_key, buckets)
            probability = float(torch.sigmoid(logits[0, -1, target]).item())
        return {
            "probability": max(0.01, min(0.99, probability)),
            "sequence_length": len(rows),
            "trained": bool(train and len(rows) >= 4),
            "loaded": loaded,
            "loss": round(loss_value, 6) if loss_value is not None else None,
            "model": "hashed-skill-gru-dkt",
        }
