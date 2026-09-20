---
'@zhin.js/plugin-runtime': patch
'@zhin.js/agent': patch
'@zhin.js/plugin-rss': patch
'@zhin.js/plugin-content-moderation': patch
'@zhin.js/plugin-music': patch
'zhin.js': patch
---

Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.
