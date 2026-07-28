---
"@zhin.js/adapter-kook": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-github": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/adapter-dingtalk": minor
"@zhin.js/adapter-lark": minor
"@zhin.js/adapter-line": minor
"@zhin.js/adapter-satori": minor
"@zhin.js/adapter-wechat-mp": minor
"@zhin.js/adapter-wecom": minor
"@zhin.js/adapter-weixin-ilink": minor
---

endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
