---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
---

ADR 0043 §2/§3: the history sent to the model is bounded by a token budget (`ai.context.historyTokens`: group 8000, ordinary private 12000, master private 24000, a number for all scenes or per-scene overrides, `0` = off; `ai.context.maxRecentMessages` stays as a message-count upper bound). The budget is measured after projection, the window starts on a turn boundary, and it only moves — in one block leaving 25% headroom — when the budget is exceeded, so the prompt-cache prefix stays stable. Tool results of finished turns (and very long call arguments) reach the model as their first 200 characters plus `…(已省略 N 字)`; the current turn and stored history are unchanged.
