import type { KnowledgeFlashcard } from "@/lib/api";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";
import { PALETTE_THEME, topicEmoji, topicPalette, type FlashcardPalette } from "@/lib/flashcardVisual";

export function formatFlashcardShareText(card: KnowledgeFlashcard): string {
  const front = normalizeFlashcardFront(card.front_text);
  const back = (card.back_text || "").trim().slice(0, 400);
  const topic = card.topic || "知识点";
  return [`📌 ${topic}`, ``, `❓ ${front}`, ``, `💡 ${back}`, ``, `—— 来自 Knotory · 刷懂每一个知识点`].join("\n");
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const chars = [...text];
  let line = "";
  let cy = y;
  let lines = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = chars[i];
      cy += lineHeight;
      lines += 1;
      if (lines >= maxLines - 1) {
        const rest = chars.slice(i).join("");
        let tail = rest;
        while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 1) tail = tail.slice(0, -1);
        ctx.fillText(`${tail}…`, x, cy);
        return cy + lineHeight;
      }
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

export async function renderFlashcardShareImage(card: KnowledgeFlashcard): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建分享图");

  const palette = ((card.visual_palette as FlashcardPalette) || topicPalette(card.topic)) as FlashcardPalette;
  const theme = PALETTE_THEME[palette] ?? PALETTE_THEME.slate;
  const emoji = card.visual_emoji || topicEmoji(card.topic);
  const topic = card.topic || "知识点";
  const front = normalizeFlashcardFront(card.front_text);
  const back = (card.back_text || "").trim().slice(0, 280);

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.gradient[0]);
  grad.addColorStop(1, theme.gradient[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.roundRect(72, 120, W - 144, H - 280, 48);
  ctx.fill();

  ctx.font = "96px system-ui, sans-serif";
  ctx.fillStyle = theme.text;
  ctx.fillText(emoji, 120, 260);

  ctx.font = "bold 52px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = theme.accent;
  ctx.fillText(topic.slice(0, 24), 220, 260);

  ctx.font = "bold 64px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = theme.text;
  ctx.fillText("❓", 120, 380);

  ctx.font = "52px system-ui, -apple-system, sans-serif";
  let y = wrapCanvasText(ctx, front, 120, 460, W - 240, 72, 5);

  if (back) {
    y += 40;
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillStyle = theme.accent;
    ctx.fillText("💡", 120, y);
    y += 20;
    ctx.font = "46px system-ui, sans-serif";
    ctx.fillStyle = theme.text;
    wrapCanvasText(ctx, back, 120, y + 40, W - 240, 64, 6);
  }

  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.fillStyle = theme.accent;
  ctx.fillText("Knotory", 120, H - 160);
  ctx.font = "36px system-ui, sans-serif";
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = 0.75;
  ctx.fillText("刷懂每一个知识点", 120, H - 100);
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("分享图生成失败"));
    }, "image/png");
  });
}

export type ShareFlashcardResult = "shared" | "downloaded" | "copied";

export async function shareFlashcard(card: KnowledgeFlashcard): Promise<ShareFlashcardResult> {
  const text = formatFlashcardShareText(card);
  let blob: Blob | null = null;
  try {
    blob = await renderFlashcardShareImage(card);
  } catch {
    /* 降级为纯文本 */
  }

  if (blob && typeof navigator.share === "function") {
    try {
      const file = new File([blob], `knotory-${card.id}.png`, { type: "image/png" });
      const payload: ShareData = { title: card.topic || "Knotory 知识点", text, files: [file] };
      if (navigator.canShare?.(payload)) {
        await navigator.share(payload);
        return "shared";
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }

  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knotory-${card.topic || "card"}.png`;
    a.click();
    URL.revokeObjectURL(url);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
    return "downloaded";
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return "copied";
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return "copied";
}

/** @deprecated 使用 shareFlashcard */
export async function copyFlashcardShare(card: KnowledgeFlashcard): Promise<void> {
  await shareFlashcard(card);
}
