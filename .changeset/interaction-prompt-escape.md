---
"@zhin.js/core": patch
"@zhin.js/command": patch
"@zhin.js/agent": patch
"@zhin.js/plugin-reminder": patch
---

等待中的提问不再吞掉消息（#1250 `interaction-prompt-swallows-messages`，ADR 0061 决定 11 修订）：`select`、多选、数字、列表提问认取消词「取消」「退出」「cancel」「exit」「quit」（中英文通用，提示里写明「回复『取消』退出」），取消后 `ask()` 以 `UserInteractionCancelledError` 结束并回复「已取消」；等待期间被问者发了能匹配到指令的消息、带图片 / 文件 / 语音 / 视频的消息或 @ 了机器人，提问结束、回复一次「已退出上一个选择」（每人每分钟最多一次），这条消息按正常流程处理；其余无效回答限频提醒（每次提问最多 2 次、间隔至少 20 秒），不再静默等待。

提问超时、取消、被打断、被顶替不再记成 `internal_error`（#1250 `interaction-timeout-reported-as-internal-error`）：入站结局新增 `interaction_timeout` 与 `interaction_cancelled`，日志为 INFO，不算故障。Agent 工具审批的提问被取消或打断时按用户拒绝处理；提醒插件把被打断的提问当作已结束。
