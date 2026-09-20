---
name: napcat
platforms: [napcat]
description: NapCatQQ 消息、群运营、文件、多媒体和账号扩展能力。
keywords: [napcat, qq, forward, reaction, notice, file, tts, ocr]
tags: [adapter, messaging, media]
tools:
  - send_poke
  - set_emoji_reaction
  - send_forward_msg
  - forward_single_msg
  - send_like
  - set_essence_msg
  - delete_essence_msg
  - get_essence_list
  - send_group_notice
  - get_group_notice
  - del_group_notice
  - upload_group_file
  - get_group_file_url
  - get_group_root_files
  - get_group_shut_list
  - set_group_portrait
  - set_title
  - group_sign
  - ai_tts
  - get_ai_characters
  - ocr_image
  - get_mini_app_ark
  - get_group_msg_history
  - get_friend_msg_history
  - get_user_status
  - get_group_info_ex
  - set_profile
  - set_avatar
  - set_online_status
  - set_signature
  - translate
  - mark_msg_as_read
  - download_file
  - delete_friend
---

# NapCatQQ

按任务选择最窄的 Tool：

- 消息互动：戳一戳、点赞、reaction、单条或合并转发、已读标记。
- 群运营：精华消息、群公告、签到、群头像、专属头衔和扩展群信息。
- 文件与历史：群文件上传/列表/下载地址，以及群聊或好友消息历史。
- 多媒体：AI 语音角色与 TTS、OCR、小程序卡片。
- 账号资料：头像、资料、在线状态、签名；`delete_friend` 会删除好友关系。

先查询再写入，使用工具返回的稳定 ID。公告删除、精华删除、资料修改、文件上传和删除好友等外部副作用必须遵守 Tool 审批策略。

当前 Agent Tool 不提供踢人、成员禁言、设管理员、改群名片或成员列表；`get_group_shut_list` 只能读取已有禁言记录。
