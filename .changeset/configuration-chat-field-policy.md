---
"@zhin.js/cli": patch
---

新增 Bot 主人私聊配置指令 `config fields|get|set|unset`（别名 `配置`）：仅接收消息的账号 `master` 在私聊中可用，首版不认 `ai.trigger.masters`；Host 段仅开放 `HOST_CONFIG_PATCH_PATHS`，拒绝权限字段、敏感字段与声明写入，只读写单个叶子字段，复用项目补丁的单次 CAS 与按组应用（Refs #1139 P2）。
