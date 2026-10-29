---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Stop the bot from reacting with an emoji on every turn. The structured-reply instruction now says reactions are occasional (`""` is the default), and the host paces reactions per session: at most one per `ai.agent.reactions.cooldownMs` (default 10 min) and only with `probability` (default 0.35; 0 disables). Paced-out reactions are not sent, count as handled, and are audited as `{ reaction: true, applied: false, paced: true }`. Memory only, bounded to 1024 sessions.
