---
title: Track expenses in chat without exposing amounts in groups
description: Record personal expenses with commands, summarize by day, week, month and category, deliver amounts privately in groups, and opt in to a daily report
---

# Track expenses in chat without exposing amounts in groups

With the ledger plugin loaded, send `记 午饭 18.5` to record an expense. `本周消费` shows the week's total with a per-category breakdown, and `删账 <id>` deletes one of your own entries. No model or Agent is required. Commands use Chinese aliases; each also has an English name such as `ledger-add`.

## Prepare

Follow the [ledger plugin README](https://github.com/zhinjs/zhin/tree/main/plugins/utils/ledger) to install it with a persistent Database Host. Set `timezone` to your local IANA timezone: today, this week (starting Monday) and this month are all computed in it. The daily report also needs the Schedule Feature.

## Record and query

```text
记 午饭 18.5 和同事
记 打车 23
今日消费
本周消费
本月消费
分类统计 本月
账单
删账 2
```

Amounts are stored as integer cents with at most two decimals; negative or malformed amounts are rejected. Each person's entries are stored separately and ids only refer to your own entries.

## Use it in a group

Recording works in groups, but replies hide the amount. Query results are sent to you privately and the group only sees a notice. When the platform cannot send a private message, the group sees categories and counts with amounts shown as `¥***`.

## Daily report

Send `记账日报 开启`. At the configured `reportTime` (22:00 by default) the bot privately sends the day's summary, once per day. `记账日报 关闭` cancels it.

## Done when

- `本月消费` in a private chat shows the right total and category shares.
- Amounts never appear in group messages.
- After opting in, one private daily report arrives at `reportTime`.
