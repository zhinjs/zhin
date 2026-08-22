---
"@zhin.js/core": patch
"@zhin.js/handler": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-weixin-ilink": patch
---

Add SideEventGateway so adapters forward notice/request/system into HandlerIndex. HandlerContext now exposes only generation-safe capabilities and prompt ports; live Endpoint escape hatches are removed.
