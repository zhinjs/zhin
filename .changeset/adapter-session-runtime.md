---
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/feature-kit": patch
"@zhin.js/command": patch
"@zhin.js/handler": patch
"@zhin.js/middleware": patch
"@zhin.js/core": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/client": patch
"@zhin.js/testing": patch
"zhin.js": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/scaffold-wizard": patch
---

Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.
