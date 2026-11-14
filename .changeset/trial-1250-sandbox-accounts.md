---
"@zhin.js/adapter-sandbox": patch
---

Sandbox 账号可以在 Console 管理了（#1250）：插件现在提供与其他适配器相同的 Console RPC（`createAdapterConsoleRpc`）——`status` 与 `endpoint-add` / `endpoint-update` / `endpoint-start` / `endpoint-stop` / `endpoint-remove`，不再返回 404「插件未提供该操作」；账号「接入」页可新增、停用、启用和删除 Sandbox 账号（字段 `owner`、`nickname`、`commandPrefix`）。新增插件权限 `sandbox:read`（read）与 `sandbox:write`（operate）。
