---
name: group-admin
description: >-
  群管理增强能力：群公告发送。当用户请求在群内发布公告时使用此技能的 AI 工具。
  入群欢迎、关键词自动回复、撤回提醒等功能由中间件自动处理，不需要 AI 工具调用。
  用户说「发个公告」「发布通知」时应触发。
keywords:
  - group
  - admin
  - 群管理
  - 公告
  - announce
  - 通知
  - 欢迎
  - 关键词
  - 撤回
tags:
  - group
  - management
  - admin
tools:
  - group_announce
---

# 群管理增强技能

## AI 工具

| 工具 | 用途 | 说明 |
|------|------|------|
| `group_announce` | 发送群公告 | 将内容作为正式公告发布到群 |

**Example:**
```
用户: 发个公告：明天下午三点开会
→ group_announce(content="明天下午三点开会")
```

## 自动功能（不需要工具调用）

以下功能由中间件和事件监听自动运行：

- **入群欢迎**：监听 `group_member_increase` 事件，新成员入群时自动发送欢迎消息
- **关键词回复**：通过命令预设关键词规则，消息匹配时自动触发回复
- **撤回提醒**：监听 `group_recall` 事件，有人撤回消息时在群内通知
