---
name: slack-channels
platforms:
  - slack
description: Slack 频道邀请、主题、用途和归档管理。
keywords:
  - slack
  - channel
  - invite
  - topic
  - archive
tools:
  - invite_to_channel
  - set_topic
  - set_purpose
  - archive_channel
  - unarchive
scopes:
  - group
---
# Slack 频道

先通过 slack-users 查询用户 ID，再邀请或修改目标频道。归档和恢复遵守 Tool 审批。
