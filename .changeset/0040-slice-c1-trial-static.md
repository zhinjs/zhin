---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0040 切片 C1：`change_draft` 起草后宿主自动试跑静态检查（语法 / 约定默认导出 / harness 禁止导入 / SKILL.md 与 agent.json），通过进 `ready`，失败进 `trial_failed` 并把错误交回 Agent；`.tsx` 用 esbuild 检查，全程内存、不落临时文件。
