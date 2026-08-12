---
"@zhin.js/tool": major
"@zhin.js/ai": major
"@zhin.js/mcp": major
"@zhin.js/plugin-runtime": minor
"@zhin.js/runtime": minor
"@zhin.js/agent": minor
"@zhin.js/cli": patch
---

建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

- Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
- Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
- 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
- MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
- ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。
