---
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-wechat-mp": patch
---

Unify Notice and Request payloads with their public types and runtime exports. Use camelCase fields, preserve native data under metadata, and bind canonical endpoint identity and request actions to the held generation. Remove legacy data aliases and from factories.

Keep login and lifecycle signals as independent SystemEvent payloads on system.receive, without chat conversation fields or user interaction. Update built-in adapter projections and authoring guidance.
