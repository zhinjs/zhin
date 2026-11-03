---
"@zhin.js/cli": patch
---

新增 Bot 主人私聊配置指令 `config fields|get|set|unset`（别名 `配置`）：入口按适配器——仅接收消息的同一适配器实例上任一已配置端点的 `master`（端点级，未设置时继承插件级）在私聊中可用，其他适配器与 `ai.trigger.masters` 首版不认；授权后字段范围按项目——全项目聊天安全叶子字段加 Host 白名单 `HOST_CONFIG_PATCH_PATHS`（任一合法主人可管全局，不限于授权适配器所属插件）。拒绝权限字段（包含/前后缀匹配，如 `adminIds`、`whitelist`、`bypassMasters`）、`endpoints[*].id|name` 身份重映射、敏感字段与声明写入，`set` 不得写入新的 `${…}`/`env://` 引用，只读写单个叶子字段，复用项目补丁的单次 CAS 与按组应用（Refs #1139 P2）。
