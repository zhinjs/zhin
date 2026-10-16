---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
---

新增插件用的纯文本补全 `aiCompletionToken`（`zhin.js/agent` / `@zhin.js/agent/runtime`）：`completeText()` 只做一次补全、不带任何工具，复用 provider 的重试、超时和同 provider 模型降级；`untrusted` 内容按数据块渲染且不能提前闭合；传 `onBehalfOf` 时计入用量配额。`AIProvider` 新增可选的 `completeTextResult()`，返回实际作答的模型与用量。

**行为变化**：`AIService.createAgent()` / `runAgent()` 默认不再带 `registerTool()` 注册的工具（`includeRegisteredTools` 默认改为 `false`）；需要时显式传 `includeRegisteredTools: true`。
