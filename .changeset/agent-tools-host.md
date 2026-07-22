---
"@zhin.js/plugin-runtime": minor
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-lottery": patch
---

Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
