---
name: slack
platforms:
  - slack
description: Slack 工作区管理：群管（踢人、改频道名、查成员/频道信息）、邀请用户、设置话题/用途、归档/恢复频道、置顶消息、表情反应、用户信息查询。
keywords:
  - slack
  - adapter:slack
  - 群管理
  - 频道
  - 话题
  - 置顶
  - 反应
  - 归档
  - list_members
tags:
  - group
  - management
  - im
  - enterprise
tools:
  # 平台特有工具
  - slack_invite_to_channel
  - slack_set_topic
  - slack_archive_channel
  - slack_pin_message
  - slack_add_reaction
  - slack_remove_reaction
  - slack_unpin_message
  - slack_user_info
  - slack_set_purpose
  - slack_unarchive
  # 通用群管工具
  - slack_kick_member
  - slack_set_group_name
  - slack_list_members
  - slack_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `slack_invite_to_channel` | 邀请用户加入频道 | group_admin |
| `slack_set_topic` | 设置频道话题 | user |
| `slack_set_purpose` | 设置频道用途 | user |
| `slack_archive_channel` | 归档频道 | group_admin |
| `slack_unarchive` | 恢复归档频道 | group_admin |
| `slack_pin_message` | 置顶消息 | user |
| `slack_unpin_message` | 取消置顶 | user |
| `slack_add_reaction` | 添加表情反应 | user |
| `slack_remove_reaction` | 移除表情反应 | user |
| `slack_user_info` | 查询用户信息 | user |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `slack_kick_member` | 踢出成员 | group_admin |
| `slack_set_group_name` | 修改频道名称 | group_admin |
| `slack_list_members` | 获取成员列表 | user |
| `slack_get_group_info` | 获取频道信息 | user |

## 执行规则

1. 操作成员需要 Slack 用户 ID，先 `slack_list_members` 或 `slack_user_info` 获取
2. 归档频道后不可发送消息，需 `slack_unarchive` 恢复
3. 话题和用途为频道元信息，对所有成员可见
