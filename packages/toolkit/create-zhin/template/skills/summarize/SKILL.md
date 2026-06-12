---
name: summarize
description: "Summarize conversations, logs, docs, or investigation notes into concise action-oriented text. Use when asked for a recap, handoff note, meeting summary, or durable memory. Triggers: 总结, 汇总, summarize, 交接, 复盘."
keywords:
  - summarize
  - summary
  - recap
  - notes
  - 总结
  - 交接
tags:
  - writing
  - memory
  - documentation
---

# Summarize

把已有材料压缩成**可交接、可执行**的摘要，不引入新结论。

## 何时使用

- 长对话 / 调试会话需要交接
- 日志、CI 失败、审计结果需要浓缩
- 用户要「写进 MEMORY / issue / PR 摘要」

## 工作流

### 第 1 步：确认受众与用途

| 用途 | 长度 | 必含 |
|------|------|------|
| 口头交接 | 5–10 行 | 现状、阻塞、下一步 |
| Issue/PR 摘要 | 中等 | 决策、验证命令、风险 |
| 持久记忆 | 短条目 | 稳定事实、配置约定、勿重复踩坑 |

### 第 2 步：提取事实

保留（每条附**证据来源**：对话原句 / 日志行 / 文件路径）：

- 已**确认**的结论与决策
- 跑过的命令及结果（`pnpm test` 通过/失败）
- 未解决问题与阻塞原因
- 文件路径、版本号、配置项名

剔除：

- 推测与未验证假设（单独标「待确认」）
- 重复讨论、礼貌用语

### 第 3 步：输出结构

默认模板：

```markdown
## 概要
（1–2 句）

## 已完成
- ...

## 未完成 / 阻塞
- ...

## 关键命令与结果
- `...` → ...

## 下一步（按优先级）
1. ...
```

用户要求 exhaustive 报告时再展开章节。

### 第 4 步：按场景选模板

**CI / 测试失败摘要**：

```markdown
## 概要
（哪条 CI job / 哪个包失败）

## 失败信号
- 命令：`pnpm test` / job 名
- 错误：首条可复现报错（一行）

## 已排除
- ...

## 下一步
1. ...
```

**调试会话交接**（给另一位维护者）：

```markdown
## 当前状态
- 分支 / commit：
- 服务：`http://127.0.0.1:8086` 是否可达

## 已尝试
- `命令` → 结果

## 阻塞
- ...

## 待办（按优先级）
1. ...
```

## 🔴 CHECKPOINT · 敏感信息

摘要写入 Issue、PR、公开 MEMORY 前：删除 token、`.env`、用户 ID、内网 URL；用 `<REDACTED>` 占位。

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| 上下文过长 | 先按主题分段摘要，再合并 | 请用户指定时间范围或文件 |
| 材料矛盾 | 并列列出冲突说法，标「待核实」 | 🔴 不向用户呈现单一「权威」结论 |
| 无实质内容 | 如实写「无可总结进展」 | 建议用户补充目标或日志 |

## 不要做什么

- 不要把摘要写成营销文案或过度乐观
- 不要省略失败原因（只写「有问题」）
- 不要把猜测写成事实
- 不要在摘要里泄露 token、密码、私聊 ID
- 不要默认生成超长文档（除非用户明确要求）

## 延伸阅读

| 场景 | 参考 |
|------|------|
| Issue/PR 文案 | 模板 skill `github` |
| 架构决策记录 | `docs/adr/` |
| 会话记忆落盘 | `examples/full-bot/skills/memory-consolidate/` |
