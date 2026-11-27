---
"@zhin.js/adapter-qq": patch
---

README 更正 endpoint 管理命令的权限：只有 `cancel` 接受适配器层或全局的聊天角色 `owner`，或发送者 id 与顶层 `notify.id` / `endpoints[].notify.id` 相同；`add` 与 `remove` 只接受适配器层或全局的 `owner`。已删除的 `master` 配置不会授予角色。掉线通知示例不再写入 `master`，也不再把匹配 `notify.id` 写成可以执行 `add`。
