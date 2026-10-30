---
name: qq-group-state
platforms:
  - qq
description: 当前 QQ 群的禁言状态、待处理入群申请与黑名单查询。
keywords:
  - 禁言列表
  - 入群申请
  - 黑名单
tools:
  - list_muted
  - list_join_requests
  - group_blacklist
scopes:
  - group
---
# qq-group-state

Read-only views of the current group. `list_muted` returns the global mute rule and members whose mute has not expired. `list_join_requests` and `group_blacklist` are paged invite-only APIs; error 11253 means the bot has no access.

Act on a join request with `qq-group-admin` → `handle_join_request`, after confirming the applicant. Group files are not exposed by the official API.
