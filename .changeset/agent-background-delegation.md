---
"@zhin.js/agent": minor
---

后台委派结果不再丢失（#1250 `delegate-result-lost-after-turn`）：子 Agent 的回合与汇总回合不再借用主回合的模型操作（主回合结束即关闭，导致 `AI provider: operation-closed`），而是各自从主回合保留的委派授权（`ModelDelegationAuthority`，可多次 `acquire`，随协作结束、Mailbox 关闭或代际退役释放）打开独立的模型操作；汇总结果改用主动消息经 Runtime 出站端口（IM 回合新增的 `delivery` 端口，走统一发送链）发到原会话，不再依赖已关闭的回复作用域；发送失败时向会话发一句「后台任务失败」并写 warn。子回合 trace 现在记录模型调用（`model_calls`）与实际使用的用途 / profile / 模型（新增 `model_selection`），主回合结束后才跑完的子回合单独保存 trace（`trace-subagent-model-calls-missing`）。新增导出 `captureSubTurnTracing`、`SubTurnTrace`、`SubTurnTracing`、`TurnTraceSave`、`TurnTraceModelSelection`。
