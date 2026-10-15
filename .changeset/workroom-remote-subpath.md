---
"@zhin.js/workroom": patch
"@zhin.js/a2a": patch
"@zhin.js/cli": patch
---

remote dispatch / callback / assignment 导出从 `@zhin.js/workroom` 包根移到 `@zhin.js/workroom/remote` 子路径并冻结（A2A 扩展）。默认 Workroom 装配仍会创建 Remote Callback Runtime 与 Remote Assignment Authority（旧 Kernel/runtime 路径依赖），留到 C2 之后处理；仅 A2A callback/executor HTTP transport 接线在配置 `a2a.workroomCallbacks.enabled` 时懒加载该子路径。内核事件格式与历史事件校验（fail-closed）不变。
