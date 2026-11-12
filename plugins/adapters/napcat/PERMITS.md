# NapCat Platform Permits（QQ 群）

## 入站字段

OneBot `sender.role` 透传：`owner` · `admin` · `member`。

| 字段 | 写入 |
|------|------|
| `$sender.role` | `owner` / `admin` |
| `$sender.permissions` | 同 `role` |

## Permit 词汇表

| `platform-permission:…` | 含义 |
|----------------------|------|
| `platform:owner` | 群主 |
| `platform:admin` | 群管理员（含群主） |

使用 core 默认 `createSceneRolePlatformChecker`。
