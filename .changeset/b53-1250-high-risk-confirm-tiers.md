---
"@zhin.js/agent": minor
"@zhin.js/runtime": minor
"@zhin.js/cli": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-content-moderation": patch
---

读取外部内容后的高危动作确认按类别分级，第一方声明 `readOnly` 的工具结果算受信输出（#1250 第 53 批，[ADR 0067](https://github.com/zhinjs/zhin/blob/main/docs/adr/0067-high-risk-confirm-tiers.md)）。

- `ai.agent.injectionGuard.confirmHighRisk` 改为按类别分级：执行命令 `shell`、写文件 `fileWrite`（新增类别）、外发 / 跨会话发送 `outbound`、修改配置 `config`、定时任务 / 提醒 `schedule`，每类可设 `off` / `untrusted_content` / `any_content` / `always`。默认 `schedule: untrusted_content`，其余 `any_content`。
- 工具结果的来源判定：第一方插件（包名为 `zhin.js` 或在 `@zhin.js/` 作用域下）声明了有效 `readOnly: true`（无 `risk: 'dangerous'`、无 `riskCategory`、名称不属于高危类别）、且不是 MCP 工具、没有 `external_content` 标签的工具，其结果算**受信输出**；MCP 工具（即使上游 `readOnlyHint: true`）、网页、文件、记忆、子 Agent 报告、群聊背景仍算外部内容。
- `@zhin.js/agent`（`./security`、`./config`）新增导出：`HighRiskConfirmLevel`、`HighRiskConfirmTiers`、`ConfirmHighRiskSetting`、`HighRiskConfirmPolicy`、`InjectionGuardConfig`、`HIGH_RISK_ACTION_KINDS`、`HIGH_RISK_CONFIG_KEYS`、`DEFAULT_HIGH_RISK_CONFIRM`、`resolveHighRiskConfirm()`、`stricterConfirmLevel()`、`classifyToolOutput()`、`isFileWriteToolName()`、`EXTERNAL_CONTENT_TAG` / `TRUSTED_OUTPUT_TAG`、`isFirstPartyPluginPackage()`；`HighRiskActionKind` 新增 `'file_write'`；`ToolCapability` 新增可选 `firstParty`；`ZhinAgentConfig.injectionGuard` 改为 `InjectionGuardConfig`；审批策略指纹 `APPROVAL_POLICY_REVISION` 升为 3（旧规则下被拒的调用会提示「策略已变更」）。
- `@zhin.js/runtime`：`host-config-schema.json` 中 `confirmHighRisk` 改为「字符串 | 按类别对象」，字符串新增 `always`，并去掉 `default`（让「没写」与「显式写了 `external_content`」可以区分）。
- `@zhin.js/cli`：`zhin doctor`「审批渠道」一项按类别描述；所有类别都关闭时报 `warn` 并给出更窄的替代写法，部分关闭时列出关闭的类别，显式写了字符串 `external_content` 时提示迁移方式。
- 官方插件：`@zhin.js/plugin-60s` 的天气、汇率、金价、油价、摸鱼日历工具补 `readOnly: true`；`@zhin.js/adapter-qq` 的群信息 / 群成员 / 禁言列表 / 黑名单 / 加群申请 / 会话信息工具与 `@zhin.js/plugin-content-moderation` 的 `moderation_check` 补 `external_content` 标签（返回他人可写的文本，不算受信输出）。

**兼容性**：原来的字符串写法照旧可用——`external_content` 保持原来的严格程度（映射为所有类别 `any_content`，不享受定时任务的放宽，并同样覆盖新增的写文件类别），`off` 映射为所有类别 `off`，新增的 `always` 映射为所有类别 `always`；无法识别的值按 `any_content` 处理。已有的显式配置都不会被放宽。

**行为变化**：

- 默认配置（不写 `confirmHighRisk`）下，「查天气 + 建提醒」不用再确认：只读过第一方只读工具的结果后建定时任务 / 提醒，不确认、也不会因为没有确认渠道或无人值守而被拒。读过网页、MCP 结果、文件内容等外部内容后建提醒仍要确认；执行命令、写文件、外发、改配置在读过任何内容（含受信输出）后仍要确认。
- 收紧：写文件新增为高危类别，读过任何内容后要确认，无人值守回合中直接拒绝；需要恢复原行为可设 `confirmHighRisk: { fileWrite: off }`。
