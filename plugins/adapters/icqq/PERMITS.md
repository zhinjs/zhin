# ICQQ Agent 权限与会话信息

调用者的角色与 Bot 的平台角色相互独立。`role(master,admin,trusted,owner)` 由框架校验调用者；它不代表 Bot 是群管理员。群管操作还需检查 Bot 与目标成员的实时平台身份。

选择 ICQQ Agent 后，先从目录加载对应 Skill，其私有工具才会暴露。`icqq-conversation` 的 `conversation_info` 按当前 endpoint 查询 Bot 自己的身份及群／频道信息，不把共享会话画像当作权限依据，也不在每条聊天消息前增加一次角色查询。

| Skill / 工具 | 调用方要求 | 平台能力与审批 |
|---|---|---|
| `icqq-conversation` / `conversation_info` | 当前 ICQQ 会话 | 只读，无逐次审批；群角色实时查询，频道查不到自身记录时为 unknown |
| `icqq-messages` / `quote_reply`、`forward_messages` | 普通消息操作权限 | 当前群／私聊的真实消息，无逐次审批；发送经过统一出站链路 |
| `icqq-messages` / `recall_own_message` | 不要求群管角色 | 必须是 Bot 自己在当前群／私聊的发言，无逐次审批；由平台决定可撤回时限 |
| `icqq-group-admin` / `recall_member_message` | master/admin/trusted/owner | 无逐次审批；Bot 管理员可撤回普通成员，Bot 群主可撤回管理员或普通成员，执行前实时检查 |
| `icqq-group-admin` / `group_leave` | 仅 master | 当前群，每次人工审批；Bot 为群主时拒绝，以免 SDK 解散群 |
| `icqq-group-admin` / `group_kick` | master/admin/trusted/owner | 每次人工审批；执行前检查 Bot 与目标成员角色 |

已配置的自动群审核独立按获准规则执行撤回；上述工具不新增审核触发条件、敏感类别、处罚或目标群。Bot 对自己的消息始终不需要群管权限；平台拒绝或未确认时不能宣称撤回成功，也不自动重试。

引用和转发只接受当前会话内可核实的原消息 ID，不允许跨会话读取／转发或伪造作者。读取入站引用和转发仍使用 `inspect_conversation_reference`，它不是发送工具。

当前 guild-channel 接入可查询频道信息和 Bot 的 guild 角色，但没有这些消息操作和退群工具。SDK 的成员列表可能不完整；`channel_admin` 也未携带所管子频道的范围，不能据此判断当前子频道有管理权限。不要把 QQ 号、群号、guild ID 和 tiny ID 混用。
