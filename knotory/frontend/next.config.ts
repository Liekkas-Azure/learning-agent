import type { NextConfig } from "next";

const backendUrl = (process.env.KNOTORY_BACKEND_URL || "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  /** 上传 / 入库含 LLM 摘要，经 rewrites 反代时需放宽默认 30s 限制 */
  experimental: {
    proxyTimeout: 300_000,
  },
  /** 使用 http://127.0.0.1:3010 打开时，允许拉取 /_next/* 静态资源（与 localhost 视为不同源） */
  allowedDevOrigins: ["127.0.0.1"],
  /** 生产部署：仅开放前端端口时，由 Next 将 /api、/health 反代到本机 FastAPI */
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/health", destination: `${backendUrl}/health` },
      { source: "/docs", destination: `${backendUrl}/docs` },
      { source: "/openapi.json", destination: `${backendUrl}/openapi.json` },
      { source: "/redoc", destination: `${backendUrl}/redoc` },
    ];
  },
};

export default nextConfig;
