---
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-line": patch
---

各适配器按平台能力上报入站发送者的 `sender.platform`（ADR 0056 §1），并在能力画像 `scene.platformStanding` 中声明：OneBot11、NapCat、Milky、ICQQ 群消息上报群主 / 管理员 / 成员；QQ 官方频道上报频道主 / 超级管理员与身份组；Discord 服务器频道上报所有者 / 管理员 / 成员、身份组与 snake_case 权限位；Telegram 群消息按 `getChatMember` 上报 creator / administrator / member / 已离开，以及管理员的 `can_*` 权限；KOOK 服务器频道上报服务器主 / 管理员角色、角色列表与权限位；飞书、钉钉群消息上报群主 / 管理员 / 成员；Sandbox 把模拟角色作为平台身份上报，不再授予框架主人角色。Satori、Slack、OneBot12、企业微信、LINE 的事件不带可靠的成员身份，不上报。README 补充「成员身份」说明。
