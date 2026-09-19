---
'@zhin.js/plugin-runtime': minor
'@zhin.js/agent': minor
'@zhin.js/plugin-rss': minor
'@zhin.js/plugin-content-moderation': minor
'@zhin.js/plugin-music': minor
'zhin.js': minor
---

Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.
