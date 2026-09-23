---
title: 工具为什么不可用？
---

# 工具为什么看不到，或者一直在等审批？

**先确认工具是否进入当前代，再看它是否允许出现在这次会话。** 工具的安装与发现、会话准入、渐进加载和执行审批是四个不同环节；只改 `requiresApproval` 不会让被过滤的工具出现。

这页适用于已安装 `@zhin.js/agent`、正在使用 Agent 工具的项目。只做命令和普通 IM 回复的项目不需要排查这一层。

## 按顺序检查

1. 工具入口是否符合 `tools/<name>/index.ts`，对应 Feature 是否安装并挂载？如果工具由 `setup()` 条件注册，先检查配置条件。
2. `platforms`、`scopes`、`permissions` 是否允许当前消息？例如 `scopes: ['group']` 不会在私聊出现；`hidden: true` 会从模型清单隐藏工具。
3. 工具是否只在 deferred catalog 中？模型可通过 `discover` 和 `load_tool` 按需加载，未出现在初始 prompt 不等于没注册。
4. 执行前才检查 `requiresApproval`：`never`、`on-risk`、`once`、`always`。它不放宽会话权限。

内置执行工具另受 `execSecurity` 和 `execApprovalMode` 控制。后者的 `ask | auto | bypass` 与单个 Tool 的 `requiresApproval` 不同；`bypass` 也不会跳过权限、文件系统、网络和危险命令检查。

定义字段、准入规则和 deferred catalog 见[工具开发](/authoring/agent-tools)；Agent 安装及内置执行策略见[AI 配置](/ai/)。
