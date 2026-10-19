---
"@zhin.js/cli": patch
---

修复 migrate 从工作区子包运行时把显式 workspace: 依赖替换为 latest 的问题，预演与实际升级均保留原依赖来源。
