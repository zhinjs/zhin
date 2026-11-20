---
"@zhin.js/core": patch
"@zhin.js/agent": minor
---

#1250 第 81 批：失败、拒绝、限流文案统一用 `createMessages` 中英双语目录，并在 ADR 0061 §1.8 写明三类失败文案（聊天失败话术、消息结局模板、命令反馈）各自的界面与边界。

- `@zhin.js/core`：消息结局模板（`formatMessageOutcome`）改由 `createMessages` 渲染，加载时检查中英文占位符一致；缺值仍显示 `—`，文案不变；模板用到 `MESSAGE_OUTCOME_PLACEHOLDERS` 以外的占位符时加载即报错；原因级模板只按自有键查找，`reason` 为 `constructor` 等原型键时回落到码级模板，不再抛错。出站媒体被拒时的占位文本（来源不被允许 / 地址不被允许）合成一个目录；`record`（语音）段在来源被拒时显示「[语音未发送：媒体来源不被允许]」/ "[audio not sent: media source not allowed]"（原为「附件」/ "attachment"）。
- `@zhin.js/agent`：模型没写出可见回复时的英文兜底按被拒工具数量用单复数（一个工具为 "The required tool `x` was denied and did not run"，原为 "tools … were"）；中文不变，`/clear` 照写（它不看命令前缀）。回合末「操作未执行」说明、后台协作的失败 / 停止 / 补充行改用 `createMessages`，文案不变。（不兼容）删除 `@zhin.js/agent/runtime` 的导出 `renderTriggerError()` 与内置的「❌ AI 处理失败: {error}」模板（生产路径本就不会用到它）：回合失败的聊天回复只经 `renderChatTurnError()`，配置了 `ai.trigger.errorTemplate` 时照旧替换 `{error}` 发出（错误信息里的 `$&`、`$'` 等按原文插入，不再被当作替换模式），未配置时是聊天失败话术。
