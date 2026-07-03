# ICQQ Platform Permits（QQ 群）

## 入站字段

群成员 `owner` / `admin` / `member` 写入 `$sender.role`（IPC 侧已有）。

## Permit 词汇表

| `platform(icqq,…)` | 含义 |
|--------------------|------|
| `scene_owner` | 群主 |
| `scene_admin` | 群管理员（含群主） |

## 扩展工具示例

| 工具 | permit |
|------|--------|
| `icqq_set_title` | `scene_owner` |
| `icqq_announce` / `icqq_essence` / `icqq_list_muted` | `scene_admin` |
| `icqq_set_anonymous` | `scene_owner` |

工厂群管工具使用默认 `scene_admin` / `scene_owner`。
