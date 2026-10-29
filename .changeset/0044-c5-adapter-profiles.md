---
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-sandbox": patch
---

ADR 0044 C5: every official adapter now declares a capability `profile` (its `segments` moved into `profile.default.messaging.segments`). icqq declares the complete profile (per conversation kind: scene, all 14 actions with real limits, events, feedback, delivery) and implements the seven new management ports (`pokeUser`, `unmuteGroupMember`, `muteAllGroupMembers`, `setGroupCard`, `setGroupTitle`, `setGroupEssence`, `inviteGroupMember`) with fresh bot-role reads. qq official declares its passive reply windows; undeclared capabilities stay unsupported.
