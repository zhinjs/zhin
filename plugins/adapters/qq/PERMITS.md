# QQ 官方 Platform Permits

## 入站字段（ADR 0056 §1）

仅**频道**（guild 子频道）消息上报 `sender.platform`，取自事件自带的 `member.roles`：

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | `owner`（频道主，身份组 4）· `admin`（超级管理员，身份组 2）· `member` |
| `sender.platform.roles` | 原始身份组 id（内置身份带名称） |

QQ 群、单聊与频道私信不上报发送者平台身份；QQ 官方事件没有权限位，`permissions` 不上报。机器人自身身份：群取 `getBotState.member_role`，频道取机器人成员的身份组。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:owner` / `platform:admin` | 频道主 / 超级管理员（含频道主） |
| `platform-role:<id>` | 持有指定身份组 |
| `bot:*` / `bot-role:<id>` | 同上，判定机器人账号自身 |

平台身份与机器人身份都按**当前会话**判定，因此群 / 频道管理工具只作用于当前群或当前频道。
