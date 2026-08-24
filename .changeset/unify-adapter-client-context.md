---
"@zhin.js/feature-kit": patch
"@zhin.js/adapter": patch
"@zhin.js/command": patch
"@zhin.js/middleware": patch
"@zhin.js/tool": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-discord": patch
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
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-weixin-ilink": patch
"zhin.js": patch
---

Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
