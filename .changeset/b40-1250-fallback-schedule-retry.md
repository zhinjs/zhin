---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

网络错误和 5xx 在同模型重试用完后换备用模型；模型失败的定时任务记为失败并自动重试，接收人收到能看懂的说明（#1250 第 40 批）。

- `fallback-skips-network-and-5xx`：用途备用层原先规定网络错误和 5xx 永远不切换，主模型（中转站账号）临时连不上时三次请求都打在它上面。现在 `provider-resilience` 通过新增的可选 `StreamOptions.willRetry` 告诉下层「这次失败还会不会在同一模型上重试」；网络错误和 5xx 在同模型重试用完（原先记 `provider_give_up` 的那一次）时换到下一个备用模型，备用模型用它自己的重试策略，也失败就再换下一个。切换只在本次操作内生效；2 分钟内至少 2 个不同操作都这样放弃同一模型，才全局跳过 5 分钟（与超时分开计数，`ModelFallbackReason` 新增 `network` / `server`）。没有切换的失败经 `FallbackCompletionOptions.onFallbackSkipped` 记入日志 `fallback_skipped` 与回合 trace（`model_fallback_skips`，时间线 `fallback_skipped`），原因为 `no_fallbacks`、`not_switching`、`exhausted`、`streamed` 或 `retry_forbidden`；切换仍记 `model_fallback`（含原因与换到的模型）。
- `schedule-failed-run-marked-ok`：回合因模型请求失败结束时，`turn_end` 新增可选的 `modelFailure`（错误类型、原文、账号显示名），回合 trace 结束状态记为 `failed`（`model_error:<类型>`）。定时任务把这样的运行记为失败：`lastStatus: 'error'`，`lastError` 写明错误类型与 `zhin trace <回合>`，失败文案不再当作任务结果发出。网络错误、5xx、超时、无响应时由调度器约 5 分钟、10 分钟后各重试一次（不占执行队列，只在没有已生效或结果不明的工具操作时重试；暂停、删除或下次到点会取消），执行队列不再对模型失败立即重跑。
- `empty-reply-fallback-misleading`：定时任务的接收人不再收到「连接模型服务失败，请检查网络后再试」，而是在重试全部失败（或这类错误不重试）后收到「『工作日天气早报』这次没生成：模型服务（<账号名>）暂时连不上，已自动重试 2 次，不再重试。排查：zhin trace <回合>」；开启 `notifyOnFailure` 的任务每次失败都收到，未重试完时写「N 分钟后会自动重试」。中英文两版，普通聊天的提示不变。
