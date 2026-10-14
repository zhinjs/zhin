---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
