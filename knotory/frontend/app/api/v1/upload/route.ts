import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const backendUrl = (process.env.KNOTORY_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

/** 上传走 Route Handler 直连 FastAPI，避免 rewrites 默认 30s 代理超时。 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);

  try {
    const upstream = await fetch(`${backendUrl}/api/v1/upload`, {
      method: "POST",
      body: formData,
      headers,
      signal: controller.signal,
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (e) {
    const aborted =
      e !== null && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError";
    if (aborted) {
      return NextResponse.json({ detail: "上传处理超时，请稍后重试。" }, { status: 504 });
    }
    return NextResponse.json({ detail: "上传代理失败，请稍后重试。" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
