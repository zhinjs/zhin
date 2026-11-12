---
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-line": patch
---

适配器工具的操作目标与角色层级收尾（ADR 0056 §5）：

- KOOK：`kook_grant_role` / `kook_revoke_role` 要求目标角色严格低于发起者的最高角色（KOOK 角色 `position` 值越小优先级越高；服务器主豁免；「全体成员」与不存在的角色拒绝），低位 `manage_roles` 成员不能借机器人给自己授予更高角色；`kook_blacklist` 拉黑时要求目标成员低于发起者、不能拉黑服务器主；`kook_list_roles` 改为只读当前服务器（去掉 `guild_id`）。
- 不带层级限定 owner 的工具不再接受任意群 / 频道 / 会话 ID，目标改为取自当前会话（模型传入的 ID 被忽略）：
  - ICQQ：`group_invite`、`group_member_info`、`group_sign`、`poke`、`group_files`、`list_muted`；
  - Discord：`discord_react`、`discord_send_embed`（当前频道 / 线程 / 私信）、`discord_forum_post`（在当前帖子所属的论坛发帖）；
  - NapCat：精华列表、群公告列表、群文件（根目录、下载链接、上传）、群消息历史、AI 语音与角色、群详情、禁言列表、群签到；`get_friend_msg_history` 只读当前私聊；`send_poke` 在当前会话；`send_forward_msg` 发往当前会话，引用已有消息的节点只能引用当前会话的消息；
  - Slack：`slack_add_reaction`、`slack_remove_reaction`、`slack_edit_message`；
  - Telegram：`telegram_list_admins`、`telegram_member_count`、`telegram_react`、`telegram_send_poll`、`telegram_send_sticker`；
  - LINE：`line_get_group_members`。
- 本身就跨会话的工具改为要求全局层 `owner`（`owner@global`）：NapCat `forward_single_msg`（转发任意消息到任意好友 / 群）、`upload_group_file`（`file` 可为宿主本地路径）、钉钉 `dingtalk_send_work_notice`、企业微信 `wecom_send_text`（发给任意用户）。
- 各适配器 `PERMITS.md` 同步（Slack `slack_unarchive`、钉钉跨群工具更正为 `owner@global`）。
