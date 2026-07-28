---
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
---

endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
