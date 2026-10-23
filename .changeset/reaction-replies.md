---
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
---

Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
