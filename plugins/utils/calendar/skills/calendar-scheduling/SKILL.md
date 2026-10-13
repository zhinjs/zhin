---
name: calendar-scheduling
description: >-
  查询日历空闲、列出事件并在确认后创建日程。默认时区来自插件配置（默认 Asia/Manila）。
  Use when the user mentions meetings, availability, calendar, 约时间, 日程.
keywords:
  - 日历
  - 日程
  - calendar
  - 约时间
  - free time
  - 有空
tags:
  - calendar
tools:
  - list_events
  - find_free_time
  - create_event
---

# 日历安排

## 何时使用

- 查某段时间有没有会、找空档、创建日程

## 工作流

1. 先确认时区（配置项 `timezone`，默认 `Asia/Manila`）和日期范围。
2. `list_events` 看已有安排；需要空档时用 `find_free_time`（尊重 `work_day_start` / `work_day_end`）。
3. **创建前复述**：标题、开始、结束、地点、时区，等用户明确同意后再调 `create_event`（仅 master，且始终要求批准）。
4. 若日历未启用，告诉用户去配置 CalDAV / Google / Microsoft，不要假装已创建。

## 注意

- 没有时区偏移的时间按配置时区解释。
- 本插件不发起 OAuth；Google / Microsoft 使用预置的 access/refresh token（环境变量）。
