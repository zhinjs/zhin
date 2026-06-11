# ICQQ Platform Permits（QQ 群）

## 入站字段

群成员 `owner` / `admin` / `member` 写入 `$sender.role`（IPC 侧已有）。

## Permit 词汇表

| `platform(icqq,…)` | 含义 |
|--------------------|------|
| `group_owner` | 群主 |
| `group_admin` | 群管理员（含群主） |

## 扩展工具示例

| 工具 | permit |
|------|--------|
| `icqq_set_title` | `group_owner` |
| `icqq_announce` / `icqq_essence` / `icqq_list_muted` | `group_admin` |
| `icqq_set_anonymous` | `group_owner` |

工厂群管工具使用默认 `group_admin` / `group_owner`。
