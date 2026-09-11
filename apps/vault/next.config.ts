import path from "path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

/** 先加载 monorepo 根目录 .env，再加载 apps/web/.env*（后者可覆盖前者） */
loadEnvConfig(path.join(__dirname, "../.."));
loadEnvConfig(__dirname);

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  /**
   * 不把 Next 的哈希 JS/CSS chunk 打进 precache，避免发版后 SW 仍按旧 manifest 提供 chunk，
   * 触发 webpack 运行时 `__webpack_modules__[id]` 为 undefined → `Cannot read properties of undefined (reading 'call')`。
   * 仍保留 manifest、图标等；首屏脚本走网络，与 next-pwa 默认「强缓存页面脚本」相比更不易跨版本损坏。
   */
  workboxOptions: {
    cleanupOutdatedCaches: true,
    skipWaiting: true,
    clientsClaim: true,
    exclude: [
      /\/_next\/static\/.*(?<!\.p)\.woff2/,
      /\.map$/,
      /^manifest.*\.js$/,
      ({ asset }: { asset: { name?: string } }) => {
        const n = asset?.name ?? "";
        return n.includes("static/chunks") || n.includes("static/css");
      },
    ],
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@learning-saas/db"],
};

export default withPWA(nextConfig);
