---
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

没装或没启用 AI 时，Console 读取不再显示「暂时无法读取」（#1250）：`GET /api/assistant/jobs` 与 `GET /api/conversations/results` 在功能关闭时返回 200 `{ success: true, data: { status: 'disabled', reason, message, …空列表 } }`，`reason` 为 `agent-not-installed`（未安装 `@zhin.js/agent`）、`agent-disabled`（已安装但 AI 未启用）或 `assistant-disabled`（`assistant.enabled` 为 false），替代原来的 404 `assistant.enabled is false` 与 503 `result_store_unavailable`（存储损坏等真实读取失败仍是 503）。任务写入（`POST /api/assistant/jobs*`）仍返回 404 与旧的 `error: 'assistant.enabled is false'`（兼容旧 CLI），新增 `code: 'unavailable'` 与 `data`（同样的 `ConsoleFeatureDisabled`）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureDisabled`、`ConsoleFeatureDisabledReason`、`consoleFeatureDisabled()`、`isConsoleFeatureDisabled()`；`zhin schedule` / `zhin watch` 识别新形状并打印原因。
