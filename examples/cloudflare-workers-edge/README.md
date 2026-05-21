# Cloudflare Workers — Zhin Edge 骨架（二期 M4）

单 `fetch` 入口，复用：

- `@zhin.js/http-host` — `createFetchApp` + `registerFetchRoute`
- `@zhin.js/storage-port` — D1/KV 绑定（`KvLike` 适配）
- `@zhin.js/queue-runtime` — `registerQueueRoutes`
- Console — `registerConsoleRoutes(..., { parity: "edge" })`

## 约束

- 不加载 IM 适配器
- `wrangler.toml` 中配置 D1/KV binding 与 `HTTP_TOKEN`
- Console UI：https://console.zhin.dev ，API Base 指向 Worker URL

完整 `src/index.ts` 实现待 Wrangler 工程脚手架合入；逻辑参考 [deno-deploy-playground](../deno-deploy-playground/src/edge-http.ts)。
