---
"@zhin.js/agent": patch
"zhin.js": patch
---

群聊插话判断看得出用的是哪个模型、有没有切到备用、用了多少 token（#1250 第 47 批 `ambient-llm-judge-invisible`）。

- 聊天模型做插话判断时，判断结果带 `source: 'language:<服务显示名>/<模型>'`；切到备用模型时 `source` 是实际作答的备用模型，并带 `fallbackFrom`（原来配置的模型）。备用信息来自用途备用层的切换观察器（`ModelFallbackLog`），切换同时记 `model_fallback` / `fallback_skipped` 日志。`ambient_engagement` 日志与 `ambient_decision` 决策审计照常带 `judge`，并新增 `fallbackFrom`；审计 payload 另带 `judgeFallbackFrom`、`judgeMs`、`judgeUsage`（只有模型、类别和用量，不含判断理由原文）。
- 每次插话判断调用（聊天模型和决策模型，成功或失败）写一行 `[ai.usage] judge`，`scene: ambient`，带模型、`fallback_from`、input / output / cache token 与耗时；决策模型没有回传用量时只写次数和耗时。
- 判断失败（`judge_failed`）时，`ambient_engagement` 日志、`ambient_decision` 审计与 `ambient_silent` 结局写明是哪个模型、什么错误类别（如 `timeout`、`auth`、`invalid_response`），不写原始错误全文。
- Console 群聊插话状态（`plugin.root.ambient`）新增 `judgeDaily`：最近 7 天每天的判断调用次数、失败与备用次数、按模型类型的次数、平均耗时和 token 合计（进程内存，重启后当天重新计），以及 `judgeTimeZone`。
