import ast
import logging
from pathlib import Path

logger = logging.getLogger("knotory.parser")

_PDF_PLACEHOLDER_MARKERS = (
    "(empty PDF text layer)",
    "(扫描 PDF 需配置",
    "(PDF 已加密",
    "(扫描页识图未返回文本",
    "(豆包识图无结果",
)


def pdf_extraction_is_placeholder(text: str) -> bool:
    """正文仅为解析失败提示、无真实文档内容时返回 True（用于上传接口返回 422）。"""
    s = (text or "").strip()
    if not s:
        return True
    return any(m in s for m in _PDF_PLACEHOLDER_MARKERS)


def read_text_with_fallback(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1", errors="ignore")


def _file_head_is_pdf(path: Path) -> bool:
    """上传落盘为 `.source` 时仍可根据魔数识别 PDF。"""
    try:
        with path.open("rb") as fh:
            return fh.read(5).startswith(b"%PDF")
    except OSError:
        return False


def _suffix_for(path: Path, original_filename: str | None) -> str:
    ext = path.suffix.lower()
    if ext == ".source" and original_filename:
        return Path(original_filename).suffix.lower()
    return ext


def _vision_backend_configured() -> bool:
    from app.config import settings  # noqa: PLC0415

    return bool(settings.resolved_ark_api_key) or bool(settings.resolved_cloud_api_key)


def _page_text_union(page: object) -> str:
    """合并多种 PyMuPDF 抽取方式，尽量捞全文本层（含部分仅 blocks 可读的版式）。"""
    chunks: list[str] = []
    try:
        t0 = page.get_text() or ""
        if isinstance(t0, str) and t0.strip():
            chunks.append(t0)
    except Exception as exc:  # noqa: BLE001
        logger.debug("page.get_text default failed: %s", exc)

    try:
        t1 = page.get_text("text", sort=True) or ""
        if isinstance(t1, str) and t1.strip():
            chunks.append(t1)
    except (TypeError, AttributeError, Exception):  # noqa: BLE001
        try:
            t1b = page.get_text("text") or ""
            if isinstance(t1b, str) and t1b.strip():
                chunks.append(t1b)
        except Exception as exc:  # noqa: BLE001
            logger.debug("page.get_text text failed: %s", exc)

    try:
        blocks = page.get_text("blocks") or []
        block_texts: list[str] = []
        for b in blocks:
            if isinstance(b, (list, tuple)) and len(b) >= 5:
                frag = b[4]
                if isinstance(frag, str) and frag.strip():
                    block_texts.append(frag.strip())
        if block_texts:
            chunks.append("\n".join(block_texts))
    except Exception as exc:  # noqa: BLE001
        logger.debug("page.get_text blocks failed: %s", exc)

    if not chunks:
        return ""
    # 取信息量最大的一段，避免重复拼接膨胀上下文
    return max(chunks, key=lambda s: len(s.strip())).strip()


def _image_text_via_llm(path: Path) -> str:
    from app.llm import transcribe_image_multivendor  # noqa: PLC0415

    return transcribe_image_multivendor(path)


def _extract_pdf(path: Path, *, ocr_enabled: bool, pdf_ocr_min_chars: int) -> str:
    try:
        import fitz  # PyMuPDF  # noqa: PLC0415
    except ImportError as exc:
        logger.warning("PDF skipped (install pymupdf): %s", exc)
        return ""

    doc = None
    try:
        doc = fitz.open(path)
        if doc.is_encrypted:
            rc = doc.authenticate("")
            if not rc:
                return "(PDF 已加密或需要密码，无法提取文本；请导出为无密码 PDF 后再上传。)"

        text_parts: list[str] = []
        for page in doc:
            text_parts.append(_page_text_union(page))
        plain = "\n".join(text_parts).strip()

        if len(plain) >= pdf_ocr_min_chars or not ocr_enabled:
            return plain or "(empty PDF text layer)"

        if not _vision_backend_configured():
            return plain or (
                "(扫描 PDF 需配置 ARK_API_KEY / DOUBAO_API_KEY，"
                "或 KNOTORY_CLOUD_API_KEY + 支持视觉的模型以逐页识图。)"
            )

        ocr_chunks: list[str] = []
        for page in doc:
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                img_path = path.parent / f"_knotory_ocr_{path.stem}_{page.number}.png"
                pix.save(str(img_path))
                chunk = _image_text_via_llm(img_path)
                if chunk.strip():
                    ocr_chunks.append(chunk)
                try:
                    img_path.unlink(missing_ok=True)
                except OSError:
                    pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("PDF page OCR failed: %s", exc)
        merged = "\n".join(ocr_chunks).strip()
        return merged or plain or (
            "(扫描页识图未返回文本；请检查 ARK 多模态接入点与 Key，"
            "或云端 KNOTORY_CLOUD_MODEL 是否支持 image_url 识图。)"
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("PDF open failed %s: %s", path, exc)
        return ""
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:  # noqa: BLE001
                pass


def extract_text(path: Path, *, original_filename: str | None = None) -> str:
    ext = _suffix_for(path, original_filename)
    if ext != ".pdf" and _file_head_is_pdf(path):
        ext = ".pdf"

    if ext == ".pdf":
        from app.config import settings  # noqa: PLC0415

        return _extract_pdf(
            path,
            ocr_enabled=settings.ocr_enabled,
            pdf_ocr_min_chars=settings.pdf_ocr_min_chars,
        )

    if ext in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}:
        from app.config import settings  # noqa: PLC0415

        if not settings.ocr_enabled:
            return f"(图片解析已关闭: {path.name})"
        if not _vision_backend_configured():
            return (
                "(图片识图需配置 ARK_API_KEY / DOUBAO_API_KEY，"
                "或 KNOTORY_CLOUD_API_KEY + 支持视觉的模型，如 gpt-4o-mini。)"
            )
        text = _image_text_via_llm(path)
        if text.strip():
            return text.strip()
        return (
            "(识图无结果；请检查 ARK_MODEL / DOUBAO_MODEL 是否为支持图片的接入点，"
            "或云端模型是否支持 image_url。)"
        )

    return read_text_with_fallback(path)


def parse_code_ast(path: Path, text: str) -> dict:
    ext = path.suffix.lower()
    if ext != ".py":
        return {"language": ext.lstrip("."), "symbols": []}

    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        logger.warning("AST parse failed for %s: %s", path, exc)
        return {"language": "python", "symbols": [], "error": str(exc)}

    symbols: list[dict] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols.append(
                {
                    "name": node.name,
                    "type": type(node).__name__,
                    "line": getattr(node, "lineno", None),
                }
            )
    return {"language": "python", "symbols": symbols}
