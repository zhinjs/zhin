---
"@zhin.js/adapter-icqq": patch
---

修复 icqq 群成员相关 Agent 工具：`group_member_info` 返回空对象（模型据此误判成员不在群里）、`group_invite` 永远判定"已在群里"、`set_mute` / `set_title` / `set_anonymous` 读旧缓存误判 Bot 不是管理员。统一改为实时查询群成员。
