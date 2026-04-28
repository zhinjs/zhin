---
name: checkin
description: >-
  签到积分系统查询能力。当用户想查看自己的积分、签到排行榜、连签天数、
  或了解签到奖励时使用。日常签到通过聊天命令触发，此技能提供积分查询的 AI 工具。
  用户说「我的积分」「排行榜」「签到排名」时应触发。
keywords:
  - checkin
  - 签到
  - sign-in
  - 积分
  - points
  - 排行
  - rank
  - 排行榜
  - 我的积分
  - 连签
tags:
  - checkin
  - points
  - gamification
tools:
  - checkin_rank
  - checkin_query
---

# 签到积分查询技能

## 工具

| 工具 | 用途 | 说明 |
|------|------|------|
| `checkin_query` | 查询用户积分 | 当前积分、连签天数等 |
| `checkin_rank` | 积分排行榜 | 群内积分 Top 排名 |

**Example:**
```
用户: 我有多少积分？
→ checkin_query(user_id=用户ID)

用户: 群里谁积分最多？
→ checkin_rank(group_id=当前群号)
```

## 注意

- 日常签到通过聊天命令（`签到`）触发，不是 AI 工具。
- 连续签到有额外奖励，中断后重新计算。
- 积分数据依赖数据库，确保数据库服务正常。
