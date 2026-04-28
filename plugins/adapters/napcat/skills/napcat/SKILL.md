---
name: napcat
platforms:
  - napcat
description: >-
  NapCatQQ 完整能力：群管理（踢人、禁言、管理员、群名片、头衔）、消息收发、
  戳一戳、表情回应、合并转发、群文件管理、精华消息、群公告、AI语音TTS、
  图片OCR、小程序卡片、消息历史、在线状态、个人资料修改等。
  仅有昵称时请先 napcat_list_members 获取 user_id。
keywords:
  - napcat
  - napneko
  - onebot11
  - adapter:napcat
  - qq
  - 群管理
  - 头衔
  - 戳一戳
  - 表情回应
  - 合并转发
  - 群文件
  - 精华消息
  - 群公告
  - AI语音
  - OCR
  - 小程序
  - list_members
tags:
  - group
  - management
  - im
  - qq
  - napcat
tools:
  # 通用群管工具（IGroupManagement 自动生成）
  - napcat_kick_member
  - napcat_mute_member
  - napcat_mute_all
  - napcat_set_admin
  - napcat_set_nickname
  - napcat_set_group_name
  - napcat_list_members
  - napcat_get_group_info
  # NapCat 扩展工具
  - napcat_send_poke
  - napcat_set_emoji_reaction
  - napcat_send_forward_msg
  - napcat_forward_single_msg
  - napcat_send_like
  - napcat_set_essence_msg
  - napcat_delete_essence_msg
  - napcat_get_essence_list
  - napcat_send_group_notice
  - napcat_get_group_notice
  - napcat_del_group_notice
  - napcat_upload_group_file
  - napcat_get_group_file_url
  - napcat_get_group_root_files
  - napcat_get_group_shut_list
  - napcat_set_group_portrait
  - napcat_set_title
  - napcat_group_sign
  - napcat_ai_tts
  - napcat_get_ai_characters
  - napcat_ocr_image
  - napcat_get_mini_app_ark
  - napcat_get_group_msg_history
  - napcat_get_friend_msg_history
  - napcat_get_user_status
  - napcat_get_group_info_ex
  - napcat_set_profile
  - napcat_set_avatar
  - napcat_set_online_status
  - napcat_set_signature
  - napcat_translate
  - napcat_mark_msg_as_read
  - napcat_download_file
  - napcat_delete_friend
---

## 工具概览

### 通用群管（IGroupManagement 自动生成）

| 工具 | 说明 | 权限 |
|------|------|------|
| `napcat_kick_member` | 踢出成员 | group_admin |
| `napcat_mute_member` | 禁言成员（duration=0 解除） | group_admin |
| `napcat_mute_all` | 全员禁言/解除 | group_admin |
| `napcat_set_admin` | 设置/取消管理员 | group_owner |
| `napcat_set_nickname` | 修改群昵称/名片 | group_admin |
| `napcat_set_group_name` | 修改群名称 | group_admin |
| `napcat_list_members` | 获取群成员列表 | user |
| `napcat_get_group_info` | 获取群信息 | user |

### NapCat 扩展

| 工具 | 说明 | 权限 |
|------|------|------|
| `napcat_send_poke` | 戳一戳 | user |
| `napcat_set_emoji_reaction` | 表情回应 | user |
| `napcat_send_forward_msg` | 合并转发 | user |
| `napcat_forward_single_msg` | 单条转发 | user |
| `napcat_send_like` | 好友点赞 | user |
| `napcat_set_essence_msg` | 设置精华消息 | group_admin |
| `napcat_delete_essence_msg` | 取消精华消息 | group_admin |
| `napcat_get_essence_list` | 精华消息列表 | user |
| `napcat_send_group_notice` | 发群公告 | group_admin |
| `napcat_get_group_notice` | 获取群公告 | user |
| `napcat_del_group_notice` | 删除群公告 | group_admin |
| `napcat_upload_group_file` | 上传群文件 | user |
| `napcat_get_group_file_url` | 获取文件链接 | user |
| `napcat_get_group_root_files` | 群文件列表 | user |
| `napcat_get_group_shut_list` | 禁言列表 | user |
| `napcat_set_group_portrait` | 设置群头像 | group_admin |
| `napcat_set_title` | 设置专属头衔 | group_owner |
| `napcat_group_sign` | 群签到/打卡 | user |
| `napcat_ai_tts` | AI 文字转语音 | user |
| `napcat_get_ai_characters` | AI 语音角色列表 | user |
| `napcat_ocr_image` | 图片 OCR | user |
| `napcat_get_mini_app_ark` | 小程序卡片签名 | user |
| `napcat_get_group_msg_history` | 群消息历史 | user |
| `napcat_get_friend_msg_history` | 私聊历史 | user |
| `napcat_get_user_status` | 用户在线状态 | user |
| `napcat_get_group_info_ex` | 群额外信息 | user |
| `napcat_set_profile` | 修改资料 | user |
| `napcat_set_avatar` | 修改头像 | user |
| `napcat_set_online_status` | 设置在线状态 | user |
| `napcat_set_signature` | 设置个性签名 | user |
| `napcat_translate` | 英译中翻译 | user |
| `napcat_mark_msg_as_read` | 标记已读 | user |
| `napcat_download_file` | 下载文件 | user |
| `napcat_delete_friend` | 删除好友 | group_admin |

## 执行规则

1. 仅有昵称时先 `napcat_list_members` 获取用户 QQ 号
2. 禁言 duration 单位为秒，默认 600（10 分钟），设为 0 解除
3. 头衔设置需要群主权限
4. AI 语音发送前可先用 `napcat_get_ai_characters` 查询可用角色
5. 合并转发的 messages 参数为 JSON 格式的 node 数组
