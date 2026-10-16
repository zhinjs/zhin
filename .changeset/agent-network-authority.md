---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
