---
"@zhin.js/workroom": patch
"@zhin.js/a2a": patch
"@zhin.js/cli": patch
---

remote dispatch / callback / assignment 导出从 `@zhin.js/workroom` 包根移到 `@zhin.js/workroom/remote` 子路径（A2A 扩展，已冻结，不在默认装配路径）。内核事件格式与历史事件校验（fail-closed）不变；CLI 仅在配置 `a2a.workroomCallbacks.enabled` 时加载该子路径。
