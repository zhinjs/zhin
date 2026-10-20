# OneBot v11 Platform Permits（QQ 群）

## 入站字段

`sender.role` 来自 OneBot 事件，经 `applyQqSenderRoleToMessageSender` 写入 `$sender.role`。

## Permit 词汇表

| `platform(onebot11,…)` | 含义 |
|------------------------|------|
| `scene_owner` | 群主 |
| `scene_admin` | 群管理员（含群主） |

工厂工具默认 `scene_admin` / `scene_owner`；扩展工具如 `onebot11_set_title` 使用 `scene_owner`。
