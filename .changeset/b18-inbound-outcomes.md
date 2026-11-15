---
"@zhin.js/core": minor
"@zhin.js/kernel": minor
"@zhin.js/logger": minor
"@zhin.js/im-contract": minor
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-group-suite": patch
---

#1250 第 18 批：入站消息结局与群聊插话（ADR 0061 P1/P2/P5、ADR 0062 §23）。

- 每条入站消息在处理结束时恰好得到一个结局（`InboundOutcomeLedger`，`finally` 提交）：命令、中间件、处理器、交互态、准入、去重、近似指令、发送失败与 Agent 入口都上报候选，按优先级取主结局，其余记为 facets；抛错记为 `internal_error` 并带错误号（`err_` + 12 位十六进制，`createErrorId` 移入 `@zhin.js/logger`），原样重新抛出。结局不存消息正文，管理员补充 ≤ 200 字并按决策审计同一套规则脱敏（`redactDecisionPayload` 下移到 `@zhin.js/kernel`，Agent 原名再导出）。
- 结局保存在进程内（2000 条 / 24 小时，静默结局每会话每分钟超过 30 条时聚合），附在消息诊断记录上（`RuntimeMessageDiagnostic.outcome`），并写一行实例日志 `op=inbound_outcome`。
- 没被 @、不是指令、本群又没开插话的群消息记 `not_addressed`（`unaddressed-message-no-record`）；旁听判定不插话记 `ambient_silent`；控制面 / 禁言记 `filtered_by_policy`。
- 群插话纳入功能开关：`ai.trigger.ambient.conversations` 是全局默认值，适配器 / 账号 / 会话层开关存进 `feature_overrides`；群管理员可在群里发「功能 关闭 / 开启 / 重置 插话」（`ambient-allowlist-only`）。
- 交互态：提问可声明 `answeredBy: 'target' | 'anyone'`（默认 `target`）；回答无效时提示最多重发一次。提醒插件的确认步骤只接受「确认」/「取消」，期间的闲聊不再让整段确认提示反复出现（`reminder-confirm-captures-chat`）。
- group-suite：`mypoints` 增加中文别名「积分」「我的积分」，`rank` 增加「排行」「积分排行」（`group-suite-zh-alias-partial`）。
