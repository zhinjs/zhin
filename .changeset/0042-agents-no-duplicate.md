---
"@zhin.js/agent": patch
---

不再在每轮 `[Agents instructions]` 中重复注入根目录 `AGENTS.md`：宿主 bootstrap（可缓存的系统提示词）已包含它时，envelope 只保留更近的子目录 `AGENTS.md`。
