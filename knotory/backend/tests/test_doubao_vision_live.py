"""联调：需 monorepo 根 .env 或环境中配置 ARK_API_KEY / DOUBAO_API_KEY（不写死在仓库）。"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest


def test_live_doubao_vision_smoke(tmp_path: Path) -> None:
    from app.config import settings
    from app.doubao import transcribe_image

    if not settings.resolved_ark_api_key:
        pytest.skip("未配置方舟 Key（可在 monorepo 根目录 .env 设置 ARK_API_KEY）")

    # 方舟要求单图最小边 ≥14px；1×1 会 400
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAfklEQVR4nNXOQREAIADDsFL/YicBETy4RkHONsokTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuIkTuL8HXh1Afc9A1BynfrHAAAAAElFTkSuQmCC"
    )
    p = tmp_path / "live.png"
    p.write_bytes(png)

    out = transcribe_image(p)
    assert isinstance(out, str)
    assert len(out.strip()) > 0, "方舟多模态应返回非空文本（描述或转写）"
