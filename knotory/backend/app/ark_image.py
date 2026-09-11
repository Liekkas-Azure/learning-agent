"""火山方舟文生图：为闪卡生成并缓存配图。"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from pathlib import Path
from typing import Literal

import httpx

from app.config import settings
from app.corpus_store import notify_path_written

logger = logging.getLogger("knotory.ark_image")

_IMAGE_DIR = "flashcard_images"
_MAX_PROMPT_CHARS = 320
_PROBE_CACHE_TTL_SEC = 600.0
_probe_cache: dict[str, object] = {"at": 0.0, "ok": False, "hint": ""}

VisualStrategy = Literal["analogy", "scenario", "process", "comparison", "cause_effect", "concrete_example"]

_STRATEGY_HINTS: dict[VisualStrategy, str] = {
    "analogy": "用日常生活里熟悉的物体或场景作类比，把抽象概念映射成读者能一眼看懂的具体画面",
    "scenario": "定格一个具体情境中的关键瞬间，让读者代入「正在发生什么」",
    "process": "用连续动作或从左到右的步骤呈现过程如何展开，强调变化顺序（不要文字标签）",
    "comparison": "左右或上下并列对比两种状态、方法或结果，突出差异与对照",
    "cause_effect": "用因果链或干预前后对比展示「因→果」，帮助理解机制",
    "concrete_example": "用一个典型小例子呈现答案的核心，聚焦最能辅助记忆的一帧画面",
}

_STRUCTURE_HEAVY_RE = re.compile(
    r"思维导图|mindmap|知识结构|知识树|标题|章节|root\(|flowchart|节点图|"
    r"主题[:：]|要点[:：]|场景[:：].*主题|罗列|关键词列表|大纲",
    re.IGNORECASE,
)


def _image_root() -> Path:
    root = settings.resolved_data_dir / "outputs" / _IMAGE_DIR
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_filename(content_key: str) -> str:
    h = hashlib.sha256(content_key.encode("utf-8")).hexdigest()[:20]
    return f"fc_{h}.png"


def _meta_path(image_path: Path) -> Path:
    return image_path.with_suffix(image_path.suffix + ".meta.json")


def _clip(text: str, limit: int) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"


def _strip_template_question(front: str) -> str:
    t = (front or "").strip()
    t = re.sub(r"^「(.+?)」的核心要点是什么？$", r"\1", t)
    t = re.sub(r"^(.+?)的核心要点是什么？$", r"\1", t)
    return t.strip()


def _extract_learning_focus(*, front_text: str, back_text: str, section_title: str, topic: str) -> str:
    """提取「读者需要理解什么」，而非章节标题。"""
    back = _clip(back_text, 180)
    if back and len(back) >= 20 and "核心要点" not in back[:30]:
        first = re.split(r"[。！？\n]", back)[0].strip()
        if len(first) >= 12:
            return _clip(first, 100)
        return back
    front = _strip_template_question(front_text)
    if len(front) >= 8 and "核心要点" not in front:
        return _clip(front, 100)
    title = _clip(section_title, 60)
    if title and title not in ("正文", "摘要"):
        return title
    return _clip(topic or "该知识点", 40)


def infer_visual_strategy(
    *,
    front_text: str = "",
    back_text: str = "",
    card_kind: str = "",
) -> VisualStrategy:
    blob = f"{front_text}\n{back_text}".lower()
    kind = (card_kind or "").strip().lower()

    if kind == "contradiction" or any(k in blob for k in ("对比", "区别", "差异", "相反", "vs", "不同于")):
        return "comparison"
    if any(k in blob for k in ("步骤", "流程", "首先", "然后", "阶段", "如何", "怎样")):
        return "process"
    if any(k in blob for k in ("为什么", "原因", "因果", "导致", "因为", "效应", "影响", "uplift", "干预")):
        return "cause_effect"
    if any(k in blob for k in ("例如", "比如", "举例", "场景", "案例", "假设")):
        return "scenario"
    if any(k in blob for k in ("类似", "如同", "好比", "比喻", "就像")):
        return "analogy"
    if "?" in front_text or "？" in front_text or "是什么" in front_text or "什么是" in front_text:
        return "concrete_example"
    return "scenario"


def _is_structure_heavy_prompt(prompt: str) -> bool:
    return bool(_STRUCTURE_HEAVY_RE.search(prompt or ""))


def _finalize_prompt(parts: list[str]) -> str:
    text = " ".join(p.strip() for p in parts if p.strip())
    return text[:_MAX_PROMPT_CHARS]


def build_flashcard_image_prompt(
    *,
    topic: str,
    section_title: str,
    visual_caption: str = "",
    front_text: str = "",
    back_text: str = "",
    card_kind: str = "",
    image_prompt: str = "",
) -> str:
    """
    生成面向「辅助理解」的文生图提示词。
    目标：类比/场景/流程/对比等，而非复述标题或知识结构图。
    """
    strategy = infer_visual_strategy(
        front_text=front_text,
        back_text=back_text,
        card_kind=card_kind,
    )
    focus = _extract_learning_focus(
        front_text=front_text,
        back_text=back_text,
        section_title=section_title,
        topic=topic,
    )
    strategy_line = _STRATEGY_HINTS[strategy]

    custom = (image_prompt or "").strip()
    if custom and not _is_structure_heavy_prompt(custom):
        return _finalize_prompt(
            [
                "教学辅助插画，帮助读者理解概念而非展示标题或知识树。",
                f"画面策略：{strategy_line}。",
                f"需要理解的核心：{focus}。",
                custom,
                "柔和扁平插画，配色清晰，浅景深，无文字无字母无水印。",
                "禁止思维导图、标题牌、章节名大字、关键词列表。",
            ]
        )

    # 忽略「知识结构示意」类 caption，改从问答正文推导
    cap = (visual_caption or "").strip()
    if _is_structure_heavy_prompt(cap) or cap in ("知识结构示意", "知识结构", "示意图"):
        cap = ""

    scene_hint = cap or _clip(_strip_template_question(front_text), 60)

    return _finalize_prompt(
        [
            "教学辅助插画，帮助读者理解概念，不是给标题或目录配图。",
            f"画面策略：{strategy_line}。",
            f"读者应通过画面理解：{focus}。",
            f"可结合问题情境：{scene_hint}。" if scene_hint and scene_hint != focus else "",
            "用一个具体、可想象的场景或类比呈现，避免抽象图标堆叠。",
            "柔和扁平插画，浅景深，配色清晰，无文字无字母无水印。",
            "禁止思维导图、树状图、标题牌、章节名称、关键词罗列。",
        ]
    )


def _read_cached(image_path: Path, prompt_hash: str) -> bool:
    meta = _meta_path(image_path)
    if not image_path.is_file() or not meta.is_file():
        return False
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    return data.get("prompt_sha256") == prompt_hash


def _write_meta(image_path: Path, *, prompt_hash: str, model: str, strategy: str = "") -> None:
    meta = _meta_path(image_path)
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(
        json.dumps({"prompt_sha256": prompt_hash, "model": model, "strategy": strategy}, ensure_ascii=False),
        encoding="utf-8",
    )
    notify_path_written(meta)


def _parse_ark_error_response(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
    except (json.JSONDecodeError, ValueError):
        return (resp.text or resp.reason_phrase or "unknown error")[:240]
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:240]
        if isinstance(err, str):
            return err[:240]
    return (resp.text or resp.reason_phrase or "unknown error")[:240]


def ark_image_config_status(*, probe: bool = False) -> dict:
    """检查文生图是否可用。默认仅校验本地配置（毫秒级），不发起远程探测。"""
    if not settings.flashcard_image_enabled:
        return {
            "ready": False,
            "model": settings.resolved_ark_image_model or "",
            "hint": "文生图已关闭（KNOTORY_FLASHCARD_IMAGE_ENABLED=false）",
        }
    if not settings.resolved_ark_api_key:
        return {
            "ready": False,
            "model": settings.resolved_ark_image_model or "",
            "hint": "未配置 ARK_API_KEY",
        }
    model = settings.resolved_ark_image_model
    if not model:
        return {
            "ready": False,
            "model": "",
            "hint": "未配置 ARK_IMAGE_MODEL（需填方舟控制台「文生图」推理接入点 ID，形如 ep-xxxxxxxx）",
        }
    if not probe:
        return {"ready": True, "model": model, "hint": ""}
    ok, hint = probe_ark_image_model()
    return {"ready": ok, "model": model, "hint": hint}


def probe_ark_image_model(*, force: bool = False) -> tuple[bool, str]:
    """
    轻量探测：不等待完整出图，仅验证 model/权限是否可用。
    成功时返回 (True, "")；失败时返回 (False, 中文说明)。
    结果缓存 10 分钟，避免首页等高频路径反复调用远程接口。
    """
    key = settings.resolved_ark_api_key
    model = settings.resolved_ark_image_model
    if not key or not model:
        return False, "未配置 ARK_API_KEY 或 ARK_IMAGE_MODEL"

    now = time.time()
    cached_at = float(_probe_cache.get("at") or 0.0)
    if not force and now - cached_at < _PROBE_CACHE_TTL_SEC:
        return bool(_probe_cache.get("ok")), str(_probe_cache.get("hint") or "")

    url = f"{settings.ark_api_base.rstrip('/')}/images/generations"
    size = (settings.flashcard_image_size or "2K").strip() or "2K"
    body = {
        "model": model,
        "prompt": "教学辅助插画：用两个对比小场景帮助理解差异，扁平风格，无文字",
        "size": size,
        "response_format": "url",
        "watermark": False,
        "sequential_image_generation": "disabled",
        "stream": False,
        "n": 1,
    }
    try:
        with httpx.Client(timeout=min(30.0, settings.flashcard_image_timeout_sec)) as client:
            resp = client.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body,
            )
    except Exception as exc:  # noqa: BLE001
        ok, hint = False, f"无法连接方舟文生图接口：{exc}"
    else:
        if resp.is_success:
            ok, hint = True, ""
        else:
            detail = _parse_ark_error_response(resp)
            if "does not exist" in detail or "InvalidEndpointOrModel" in detail:
                ok, hint = (
                    False,
                    f"推理接入点无效或未开通：{model}。请在火山方舟控制台创建「文生图」接入点，"
                    "将接入点 ID（ep- 开头）写入 ARK_IMAGE_MODEL，勿直接填公开模型名。",
                )
            elif "has not activated the model" in detail:
                ok, hint = (
                    False,
                    f"账号未开通该文生图模型。请在方舟控制台开通 Seedream 并创建推理接入点，"
                    f"再把接入点 ID 写入 ARK_IMAGE_MODEL（当前为 {model}）。",
                )
            else:
                ok, hint = False, f"文生图接口错误（HTTP {resp.status_code}）：{detail}"

    _probe_cache.update(at=now, ok=ok, hint=hint)
    return ok, hint


def generate_and_cache_flashcard_image(
    *,
    content_key: str,
    prompt: str,
    strategy: str = "",
) -> str | None:
    """
    调用方舟 images/generations，保存到 outputs/flashcard_images/。
    返回相对路径（相对数据目录 outputs/），如 flashcard_images/fc_xxx.png。
    """
    if not settings.flashcard_image_enabled:
        return None
    key = settings.resolved_ark_api_key
    model = settings.resolved_ark_image_model
    if not key or not model:
        return None
    prompt = (prompt or "").strip()
    if len(prompt) < 8:
        return None

    fname = _safe_filename(content_key)
    image_path = _image_root() / fname
    rel = f"{_IMAGE_DIR}/{fname}"
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]

    if _read_cached(image_path, prompt_hash):
        return rel

    url = f"{settings.ark_api_base.rstrip('/')}/images/generations"
    body = {
        "model": model,
        "prompt": prompt,
        "size": settings.flashcard_image_size,
        "response_format": "b64_json",
        "watermark": False,
        "sequential_image_generation": "disabled",
        "stream": False,
    }
    try:
        with httpx.Client(timeout=settings.flashcard_image_timeout_sec) as client:
            resp = client.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body,
            )
            if not resp.is_success:
                detail = _parse_ark_error_response(resp)
                logger.warning(
                    "ark image generation failed key=%s status=%s: %s",
                    content_key[:32],
                    resp.status_code,
                    detail,
                )
                return None
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ark image generation failed key=%s: %s", content_key[:32], exc)
        return None

    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        logger.warning("ark image empty response key=%s", content_key[:32])
        return None
    first = items[0] if isinstance(items[0], dict) else {}
    b64 = first.get("b64_json")
    if not b64 and first.get("url"):
        try:
            with httpx.Client(timeout=60.0) as client:
                img_resp = client.get(str(first["url"]))
                img_resp.raise_for_status()
                image_path.parent.mkdir(parents=True, exist_ok=True)
                image_path.write_bytes(img_resp.content)
                notify_path_written(image_path)
                _write_meta(image_path, prompt_hash=prompt_hash, model=model, strategy=strategy)
                return rel
        except Exception as exc:  # noqa: BLE001
            logger.warning("ark image download url failed: %s", exc)
            return None
    if not b64:
        return None
    try:
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(base64.b64decode(b64))
        notify_path_written(image_path)
    except (ValueError, OSError) as exc:
        logger.warning("ark image save failed: %s", exc)
        return None
    _write_meta(image_path, prompt_hash=prompt_hash, model=model, strategy=strategy)
    return rel


def ensure_flashcard_image_for_payload(
    payload: dict,
    *,
    image_budget: list[int],
) -> None:
    if image_budget[0] <= 0:
        return
    content_key = str(payload.get("content_key", "")).strip()
    if not content_key:
        return
    strategy = infer_visual_strategy(
        front_text=str(payload.get("front_text", "")),
        back_text=str(payload.get("back_text", "")),
        card_kind=str(payload.get("card_kind", "")),
    )
    prompt = build_flashcard_image_prompt(
        topic=str(payload.get("topic", "")),
        section_title=str(payload.get("source_title", "")),
        visual_caption=str(payload.get("visual_caption", "")),
        front_text=str(payload.get("front_text", "")),
        back_text=str(payload.get("back_text", "")),
        card_kind=str(payload.get("card_kind", "")),
        image_prompt=str(payload.get("image_prompt", "")),
    )
    rel = generate_and_cache_flashcard_image(content_key=content_key, prompt=prompt, strategy=strategy)
    if rel:
        payload["visual_image_path"] = rel
        image_budget[0] -= 1
