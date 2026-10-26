---
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-earthquake": patch
---

让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。
