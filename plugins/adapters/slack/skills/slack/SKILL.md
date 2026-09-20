---
name: slack
platforms: [slack]
description: Slack 频道元信息、归档、邀请、消息置顶、反应和编辑能力。
keywords: [slack, channel, topic, pin, reaction, invite]
tags: [adapter, collaboration]
tools:
  - invite_to_channel
  - set_topic
  - archive_channel
  - pin_message
  - add_reaction
  - remove_reaction
  - unpin_message
  - user_info
  - set_purpose
  - unarchive
  - edit_message
---

# Slack

成员相关操作先用 `user_info` 确认 Slack 用户 ID。频道可设置 topic/purpose、归档或恢复；消息可编辑、置顶、取消置顶和维护 reaction。归档、编辑和邀请属于外部写操作，应按 Tool 审批执行。

当前 Agent Tool 不提供踢人、频道改名、成员列表或频道详情查询。
