# Telegram Platform Permits

## 入站字段（ADR 0056 §1）

群 / 超级群消息经 `getChatMember` 写入 `sender.platform`：已知结果缓存 60 秒，并发消息合并为一次查询，查询失败按「未知」负缓存 10 秒；收到 `chat_member` / `my_chat_member` 更新（默认已订阅，Bot 需是管理员才会收到 `chat_member`）时以新状态覆盖缓存。

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | `owner`（creator）· `admin`（administrator）· `member`（member / restricted）· `guest`（left / kicked） |
| `sender.platform.permissions` | 仅管理员上报：去掉 `can_` 前缀的管理员权限（`restrict_members` · `pin_messages` · `change_info` · `invite_users` · `manage_chat` · …）；群主拥有全部管理员权限 |

restricted 成员的 `can_*` 是对其个人的发言许可（普通成员按群默认权限同样可能拥有），不作为平台权限上报。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:owner` / `platform:admin` | 群主 / 管理员（含群主） |
| `platform-permission:restrict_members` | 可限制成员、改群默认权限 |
| `platform-permission:pin_messages` | 可置顶 |
| `platform-permission:change_info` | 可改群信息（描述等） |
| `platform-permission:invite_users` | 可邀请成员 / 创建邀请链接 |
| `platform-permission:manage_chat` | 任何管理员都有的基础管理权限 |
| `bot:*` / `bot-permission:*` | 同上，判定机器人账号自身（`getChatMember(bot)`） |

平台身份与机器人身份都按**当前会话**判定，因此群管理工具只作用于当前群（不接受 `chat_id` 入参）。

不带平台 permit 的工具同样只作用于当前会话（不接受 `chat_id`）：`telegram_list_admins` / `telegram_member_count` 作用于当前群 / 频道；`telegram_react` / `telegram_send_poll` / `telegram_send_sticker` 作用于当前群、频道或私聊。
