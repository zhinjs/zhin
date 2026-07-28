---
"@zhin.js/adapter": patch
"@zhin.js/adapter-napcat": minor
"@zhin.js/adapter-onebot11": minor
"@zhin.js/adapter-onebot12": minor
"@zhin.js/adapter-milky": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-kook": minor
"@zhin.js/adapter-satori": minor
"@zhin.js/adapter-slack": minor
"@zhin.js/adapter-line": minor
"@zhin.js/adapter-wechat-mp": minor
"@zhin.js/adapter-weixin-ilink": minor
"@zhin.js/adapter-lark": minor
---

Console 社交读取面（management 语义端口）多平台落地：napcat/onebot11/onebot12/milky（好友+群+群成员，OneBot 标准动作）；discord/kook/satori（guild+频道+成员，分页聚合，id 保精度留字符串）；slack（workspace 成员+public channels+conversations.members）；line（群/room 成员分页+profile 回退）；wechat-mp（followers openid）；weixin-ilink（context_token 对端推导）；lark（chats+members 全分页）。`EndpointFriend.user_id`/`EndpointGroup.group_id` 放宽为 `number | string`（雪花 id 不丢精度）。telegram/wecom/dingtalk/github/email/sandbox 注明平台无列表面暂不接。
