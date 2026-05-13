# 集中 Agent 工具选择和上下文预算

Agent 工具规范化、权限检查、相关性过滤和缓存归属统一放在 `orchestrator/tool-selection.ts`，而不是散落在各个调用方。上下文窗口解析也通过显式的 Agent Runtime budget helper 完成，因此 `ZhinAgent`、`AIService` 和 subagent 会把同一份上下文容量传给历史裁剪和 `@zhin.js/ai`。

