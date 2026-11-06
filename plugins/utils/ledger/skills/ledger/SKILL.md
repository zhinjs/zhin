---
name: ledger
description: >-
  Personal expense ledger — record expenses, delete entries, view today/week/month spending summaries and category breakdowns.
keywords:
  - 记账
  - 账单
  - 消费
  - 支出
  - 开销
  - ledger
  - expense
tags:
  - ledger
  - finance
tools:
  - ledger_add
  - ledger_summary
  - ledger_list
  - ledger_delete
---

# 个人记账本 (Personal Ledger)

## 何时使用本技能

- 用户想记录一笔消费/支出（如「记一笔午饭 18.5 元」「打车花了 32」）
- 用户想查看今日、本周或本月的消费汇总或分类占比
- 用户想列出近期的账单明细或按编号删除某笔账目

## 工作流

1. **记账 (`ledger_add`)**：提取类别（`category`）、金额（`amount`，正数元）与可选备注（`note`）。需要用户批准。
2. **消费汇总与分类统计 (`ledger_summary`)**：按 `period`（`today` / `week` / `month`）查看总览（`mode: "summary"`）或分类统计（`mode: "categories"`）。
3. **账单明细 (`ledger_list`)**：按 `period` 查看带 `#编号` 的账单列表。
4. **删除账目 (`ledger_delete`)**：传入账目编号 `seq` 删除对应记录。需要用户批准。

## 注意

- 账目按发送者隔离，用户只能操作自己的账本。
- 群聊场景下会自动保护金额隐私（优先私信发送完整账单或在群内脱敏显示）。
