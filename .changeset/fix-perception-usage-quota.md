---
"@zhin.js/agent": patch
---

媒体感知预处理（perception pre-pass）的模型用量不再丢失：`describe` 返回 `usage`，并计入本回合的 `usageQuota` 与回合 token 汇总。
