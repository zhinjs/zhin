---
"@zhin.js/adapter": patch
"@zhin.js/client": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
---

feat(adapters): add per-adapter Console pages

Every platform adapter now ships a `pages/index` Console page backed by a shared
`createAdapterConsolePage` component and `createAdapterConsoleRpc` server helper:

- See running endpoints, test connectivity, and manage
  `plugins.<adapter>.endpoints` (add/remove writes `.env` references) from the
  Console instead of chat commands.
- Surface LoginAssist pending tasks (QR / slider / SMS / device) so ICQQ login no
  longer requires the terminal.
- QQ moves its QR binding flow (`qq endpoint add`) into Console actions with
  public/private selection.
- Pages are permission-gated by `<adapter>:read`; writes need `<adapter>:write`.
