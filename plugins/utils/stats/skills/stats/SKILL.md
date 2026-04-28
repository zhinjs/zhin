---
name: stats
description: >-
  消息统计查询能力。当用户想查看群内活跃排行、个人消息统计、话唠排名、
  日/周/月维度的发言数据时使用。用户说「今天谁话最多」「我发了多少消息」
  「本周活跃排行」时应触发。
keywords:
  - stats
  - 统计
  - 消息统计
  - 话唠
  - rank
  - 排行
  - 活跃
  - 我的统计
  - 周报
  - 发言
tags:
  - stats
  - analytics
  - message
tools:
  - stats_query
  - stats_user
---

# 消息统计查询技能

## 工具

| 工具 | 用途 | 说明 |
|------|------|------|
| `stats_query` | 群活跃排行 | 按日/周/月维度查看群内发言排行 |
| `stats_user` | 个人统计 | 查看某用户的消息数量和活跃时段 |

**Example:**
```
用户: 本周谁最活跃？
→ stats_query(group_id=当前群号, period="week")

用户: 我这个月发了多少消息？
→ stats_user(user_id=用户ID, period="month")
```

## 注意

- 统计数据由后台自动追踪每条消息，无需手动开启。
- 支持 day（日）、week（周）、month（月）三个维度。
