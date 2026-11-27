---
"@zhin.js/adapter-qq": patch
---

README 更正 endpoint 管理命令的权限：`add` / `cancel` / `remove` 要求适配器层或全局的聊天角色 `owner`，或发送者 id 与 `notify.id` 相同；已删除的 `master` 配置不会授予角色。掉线通知示例不再写入 `master`。
