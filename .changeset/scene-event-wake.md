---
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
