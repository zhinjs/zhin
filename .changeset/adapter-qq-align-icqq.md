---
"@zhin.js/adapter-qq": patch
---

QQ 官方适配器按官方 v2 接口向 ICQQ 能力对齐：新增 `qq-conversation` / `qq-messages` / `qq-group-directory` / `qq-group-admin` / `qq-group-state` 技能（会话信息、引用回复、撤回自己 / 成员消息、群信息与成员、移出、禁言、入群审批、禁言列表、入群申请、黑名单）及频道成员禁言 / 移出；Endpoint 管理端口补齐群成员列表、踢人、禁言与自动群审核；撤回支持入站原生消息 ID，频道消息支持表情回应。好友 / 群列表、合并转发、戳一戳、点赞、公告、精华、头衔、退群等官方无接口的能力明确标注为不支持。
