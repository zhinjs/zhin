---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

Group merge window (ADR 0038 slice A): with `ai.agent.inboundQueue.merge.enabled`, plain-text mentions from several group members within a short window (`quietMs` 1500 / `maxWaitMs` 6000, up to `maxSenders` 5) are answered by one turn instead of one reply each. Off by default until merged turns narrow permissions per sender. The master, private chats, commands, stop words and messages with media, quotes or forwards keep their own turns. New audit codes `merge_window_joined` / `merge_window_flushed` (plus the other ADR 0038 codes reserved for later slices).
