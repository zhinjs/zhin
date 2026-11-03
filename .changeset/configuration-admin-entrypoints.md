---
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
---

CLI 配置命令默认通过运行中的 Host 校验、保存并按需应用，显式离线编辑保留修订检查；新增 Bot 主人私聊配置入口，对敏感或无法证明安全的字段拒绝聊天访问，并区分保存与生效结果。
