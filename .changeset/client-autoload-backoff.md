---
"@zhin.js/client": patch
---

修复 console hooks 自动加载的零退避死循环：`useConfig` / `useConfigYaml` / `useFiles` / `useEnvFiles` / `useDatabase` 在 RPC 失败时会以全速反复请求 `/api/console/request`（状态为空 → effect 立即重试）。新增 `useAutoLoadOnce`：每次连接会话对同一 key 只自动加载一次，断连重置，手动重试仍可用。
