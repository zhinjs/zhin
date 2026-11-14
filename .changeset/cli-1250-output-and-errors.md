---
"@zhin.js/cli": patch
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/gateway": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/agent": patch
---

CLI 输出与实例错误说明（#1250）：

- CLI 的命令结果（`zhin packages info`、`zhin search`、`zhin schedule list/add/…` 等）写到 stdout，不再带 `[时间][INFO] [CLI]` 前缀；诊断日志写到 stderr，前缀只在全局 `--verbose` 时出现。`zhin packages info` 正确读取字符串形式的 `author` 与 `maintainers`，并列出已安装包的命令、Agent 工具与配置项（静态读取约定目录与 `schema.json`）。
- 实例 HTTP API（`/message/send`、`/assistant/jobs`）区分预期失败与意外异常：预期失败返回 `code`（`delivery_failed`、`endpoint_not_found`、`notify_target_missing`、`invalid_argument`、`not_found`、`unavailable`）和中文说明，发送失败的 `data` 为 `ConsoleSendFailure`；意外异常仍只返回 `Internal error`，但带日志关联 `errorId`。`zhin send` / `zhin schedule` 显示具体原因，`--debug` 显示 `errorId` 并从实例日志找出对应行。`--notify-channel im`（无目标会话）改为明确拒绝。
- 网关终端区分 node-pty「未安装」与「已安装但原生模块未构建」，后者提示在 `allowBuilds` 放行后 `pnpm rebuild node-pty`（或 `zhin migrate`）。
- 脚手架 `knowledge/faq.md` 写明换模型的两个入口（Console「AI 与模型 → 用途」与 `ai.plan.yml`）及实际优先级；`ai.agents.zhin.model` 已不再决定模型。
- Introspection 的命令、中间件、组件、工具、Prompt Section 条目带 `owner`、`pluginInstance`、`pluginPackage`（`ConsoleIntrospectionOwner`）。
- 决策审计：gate 写出的 `model_skip` 在 payload 中带 `parent`（如 `ambient_decision`），回放可折叠为一条。
