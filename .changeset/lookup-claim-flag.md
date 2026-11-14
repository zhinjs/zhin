---
"@zhin.js/agent": minor
---

标出「说查了却没调用工具」的回答（#1250 `tool-capability-unverified` 第②部分）：最终回答里出现「查了 / 查到 / 根据最新 / I checked / I looked up」这类说法、但本轮工具调用为 0 时，trace 记 `claim_without_tool_call: { phrase }`（时间线也有一条），决策回放的 `model_run` 事件 payload 记 `claimWithoutToolCall: true`、`claimPhrase` 与 `toolCalls`。只做标记，用户看到的回答不变。「根据目前 / 当前」必须后接数据类名词，否定说法（没查到 / 未查过 / didn't check / haven't checked）与「搜了一下记忆 / searched my memory」不算；子 Agent 回合的最终回答同样检查（新增 trace 注记 `final_reply`）。中英文说法列表集中在 `LOOKUP_CLAIM_PATTERNS`（新增导出 `findLookupClaim`、`claimWithoutToolCall`）。
