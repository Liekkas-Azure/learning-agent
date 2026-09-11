"""
火山方舟豆包多模态：OpenAI 兼容 `POST /api/v3/chat/completions`（与 apps/vault/lib/doubao.ts 同源约定）。
"""

from __future__ import annotations

import base64
import json
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path

from app.config import settings

logger = logging.getLogger("knotory.doubao")

_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _image_mime(path: Path) -> str:
    return _IMAGE_MIME.get(path.suffix.lower(), "image/jpeg")


def transcribe_image(path: Path) -> str:
    """单张图片：转写可见文字；几乎无字时简要描述（纯文本，非 JSON）。"""
    api_key = settings.resolved_ark_api_key
    if not api_key:
        return ""

    try:
        raw = path.read_bytes()
    except OSError as exc:
        logger.warning("Doubao vision: cannot read %s: %s", path, exc)
        return ""

    if not raw:
        return ""

    mime = _image_mime(path)
    b64 = base64.b64encode(raw).decode("ascii")
    model = settings.resolved_ark_vision_model
    url = settings.resolved_ark_chat_completions_url

    prompt = (
        "请转写图片中的全部可见文字，尽量保持原有换行与段落。若几乎没有文字，用一两句话客观描述图片内容。"
        "不要添加引号或 Markdown 代码围栏，只输出正文。"
    )

    body = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            }
        ],
    }

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last_err: str | None = None
    for attempt in range(1, 4):
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")[:500]
            last_err = f"HTTP {exc.code}: {err_body}"
            logger.warning("Doubao vision HTTP error: %s", last_err)
            if exc.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(0.22 * attempt)
                continue
            return ""
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            logger.warning("Doubao vision request failed: %s", exc)
            if attempt < 3:
                time.sleep(0.22 * attempt)
                continue
            return ""

        if isinstance(payload, dict) and payload.get("error"):
            err = payload["error"]
            msg = err.get("message", json.dumps(err)) if isinstance(err, dict) else str(err)
            last_err = msg
            logger.warning("Doubao vision API error: %s", msg[:400])
            if attempt < 3:
                time.sleep(0.22 * attempt)
                continue
            return ""

        choices = payload.get("choices") if isinstance(payload, dict) else None
        if not choices or not isinstance(choices, list):
            last_err = "missing choices"
            if attempt < 3:
                time.sleep(0.22 * attempt)
            continue
        msg0 = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = (msg0 or {}).get("content") if isinstance(msg0, dict) else None
        text = (content or "").strip() if isinstance(content, str) else ""
        if text:
            return text
        last_err = "empty content"
        if attempt < 3:
            time.sleep(0.22 * attempt)

    if last_err:
        logger.warning("Doubao vision gave up: %s", last_err[:300])
    return ""
