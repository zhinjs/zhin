---
"@zhin.js/console-protocol": minor
---

失败原因看得见（#1270 第 14 批）：新增 `ConsoleErrorDetails`、`ConsoleErrorNextStep`、`isConsoleErrorNextStep()`，`ConsoleApiErrorBody` 新增可选 `details` / `nextStep`；attention 新增 `inference.account`、`config.ineffective` 两类条目与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，条目新增可选结构化 `reason`（`ConsoleAttentionReason`，含「重启前记录」标记 `restored`），主体新增 `inferenceAccount` / `configPath`，列表新增 `status: 'starting'`；新增运行时失败记录契约 `RUNTIME_FAILURES_FILE`、`ConsoleRuntimeFailure`、`ConsoleRuntimeFailureJournal`、`ConsoleRuntimeFailureSource`。
