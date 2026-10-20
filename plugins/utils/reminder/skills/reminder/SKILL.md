---
name: reminder
description: >-
  在当前聊天会话创建/查看/取消个人提醒（到点向该会话发一条消息）。
  Use when the user asks to be reminded later in this chat.
  Do NOT use for agent re-invocation or workday/lunar cron jobs — those use schedule_add.
  Triggers: 提醒我、定时、闹钟、过会儿叫我、取消提醒.
keywords:
  - 提醒
  - reminder
  - 定时
  - 闹钟
  - remind
tags:
  - reminder
  - schedule
tools:
  - reminder_create
  - reminder_list
  - reminder_cancel
---

# 个人提醒

## 何时使用本技能

- 用户要「X 分钟后提醒我…」「每天每隔 N 秒…」（消息回到**当前会话**）
- 查看或取消**自己**在当前会话的提醒

## 何时改用 `schedule_add`

- 需要到点**再次唤醒 Agent**（执行 prompt、跑工具），而不是只发一条提醒文案
- 需要公历/农历 cron、工作日、节假日等日历语义（见原生 `schedule_*` 工具）

## 工作流

1. 确认提醒文案与时间。绝对时间必须带 `Z` 或 `±hh:mm`（例如 `2026-10-14T09:00:00+08:00`）。
2. 一次性：`after`（`10m` / `600`）或 `at`；周期：`every_seconds`（≥ 60）。
3. `reminder_create` / `reminder_cancel` 需要用户批准；创建前复述内容与时间。
4. 用 `reminder_list` 核对；取消时带上 id。

## 注意

- 提醒绑定发送者 + 精确会话（含 endpoint / 线程）；别人看不见、取消不了你的任务。
- 本插件没有 5 段 cron；周期只有固定间隔秒数。
