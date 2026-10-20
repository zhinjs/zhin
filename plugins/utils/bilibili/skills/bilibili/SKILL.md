---
name: bilibili
description: >-
  B 站（哔哩哔哩）直播与 UP 主订阅查询能力。当用户想知道某个直播间是否在播、
  某个 UP 主有没有开播，或想看看当前订阅了哪些 UP 主时使用。
  订阅的增删由聊天命令 bili sub / bili unsub 管理，推送由后台定时任务完成。
keywords:
  - bilibili
  - b站
  - 哔哩哔哩
  - 直播
  - 开播
  - up主
  - 动态
  - 订阅
tags:
  - bilibili
  - live
  - subscription
tools:
  - bili_live_status
  - bili_list_subscriptions
---

# B 站订阅技能

## 工具

| 工具 | 用途 | 说明 |
|------|------|------|
| `bili_live_status` | 查询开播状态 | 传直播间号（`room`）或 UP 主 UID（`uid`），返回是否在播、标题、链接 |
| `bili_list_subscriptions` | 查看订阅 | 列出本插件实例的全部 UP 主订阅，按会话分组 |

**Example:**
```
用户: 嘉然现在在播吗？直播间 22637261
→ bili_live_status(room="22637261")

用户: 我们订阅了哪些 UP 主？
→ bili_list_subscriptions()
```

## 注意

- 订阅的增加 / 删除走聊天命令 `bili sub <uid> [all|live|dynamic]`、`bili unsub <uid>`，不是 AI 工具。
- 推送有随机延迟和退避，B 站风控时会暂停一段时间，属于正常现象。
