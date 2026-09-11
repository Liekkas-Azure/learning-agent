# Knotory 浏览器剪藏扩展

Chrome / Edge 加载「开发者模式 → 加载已解压的扩展程序」，选择本目录。

## 使用

1. 确保 Knotory 后端运行在 `http://127.0.0.1:8000`
2. 在网页选中文字，右键「剪藏到 Knotory」，或打开扩展 popup 粘贴
3. 剪藏会调用 `POST /api/v1/clips` 并后台入库

## 配置 API Key

若后端启用了 `KNOTORY_API_KEY`，需在 `popup.js` 的 fetch headers 中加入 `Authorization: Bearer <key>`（或通过同域反向代理）。
