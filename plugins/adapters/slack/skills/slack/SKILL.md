---
name: slack
platforms:
  - slack
description: >-
  Slack 工作区管理能力。当用户在 Slack 中请求频道管理（踢人、改名、归档/恢复）、
  频道元信息（设话题/用途）、消息操作（置顶/取消置顶、表情反应）、邀请用户、
  或查询用户/频道信息时使用。即使用户没有提到 Slack，只要上下文是 Slack 场景
  且涉及上述操作，就应触发。
keywords:
  - slack
  - adapter:slack
  - 群管理
  - 频道
  - 话题
  - 置顶
  - 反应
  - 归档
  - 邀请
  - list_members
tags:
  - group
  - management
  - im
  - enterprise
tools:
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
  - slack_kick_member
  - slack_set_group_name
  - slack_list_members
  - slack_get_group_info
---

# Slack 工作区管理技能

Slack 的管理概念以「频道」为核心，与 QQ 群/Discord 服务器有本质区别。

## 核心原则

### Slack 的频道模型

Slack 没有「群主/管理员/成员」的三级权限，而是基于工作区角色（Owner/Admin/Member）+ 频道级别权限。频道分公开频道和私有频道。

### 话题 vs 用途

Slack 频道有两个元信息字段：
- **Topic（话题）**：频道当前讨论的主题，显示在频道顶部
- **Purpose（用途）**：频道的长期用途说明

用户说「设个话题」用 `slack_set_topic`，说「改一下频道说明」用 `slack_set_purpose`。

## 工具分类

### 频道管理

| 工具 | 用途 | 说明 |
|------|------|------|
| `slack_kick_member` | 移除成员 | 从频道移除 |
| `slack_invite_to_channel` | 邀请用户 | 将用户加入频道 |
| `slack_set_group_name` | 改频道名 | — |
| `slack_set_topic` | 设话题 | 频道顶部显示 |
| `slack_set_purpose` | 设用途 | 频道说明 |
| `slack_archive_channel` | 归档频道 | 归档后不可发消息 |
| `slack_unarchive` | 恢复归档 | — |
| `slack_list_members` | 成员列表 | — |
| `slack_get_group_info` | 频道信息 | — |
| `slack_user_info` | 用户信息 | 查询 Slack 用户详情 |

### 消息操作

| 工具 | 用途 | 说明 |
|------|------|------|
| `slack_pin_message` | 置顶消息 | — |
| `slack_unpin_message` | 取消置顶 | — |
| `slack_add_reaction` | 添加表情反应 | — |
| `slack_remove_reaction` | 移除表情反应 | — |

## 易错点

1. **归档后频道变为只读**，任何人都不能发消息。需要 `slack_unarchive` 恢复后才能继续使用。
2. **操作成员需要 Slack 用户 ID**（形如 `U0XXXXXXX`），不是用户名。先用 `slack_list_members` 或 `slack_user_info` 获取。
3. **Topic 和 Purpose 是两个不同的字段**，不要混淆。
