---
"@zhin.js/core": patch
"@zhin.js/agent": patch
---

core 转出 ADR 0044 能力类型（`TurnCapabilities` 等）与 `adapterFeatureId` / `isAdapterIndex`，agent 层经 core 读取，遵守依赖分层（agent 不直接依赖 adapter）。
