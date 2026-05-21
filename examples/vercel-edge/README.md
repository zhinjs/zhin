# Vercel Edge — Zhin Edge 骨架（二期 M4）

使用 Vercel Edge Function 导出 `fetch` handler，模式同 [cloudflare-workers-edge](../cloudflare-workers-edge/README.md)。

- API Base 配置为 `https://<your-app>.vercel.app`
- StoragePort 二期在 Workers 环境使用内存或 Vercel KV 适配（见 ADR-0009）

参考实现：`examples/deno-deploy-playground/src/edge-http.ts`。
