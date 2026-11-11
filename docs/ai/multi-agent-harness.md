---
title: "多 Agent 协作与场所（Agent Harness & Venues）"
description: "基于 @zhin.js/harness 的声明式多 Agent 协作、共享黑板（Blackboard）、群聊场所投影（ai.venues）与 zhin trace 追踪"
---

# 多 Agent 协作与场所（Agent Harness & Venues）

Zhin.js 采用 **Agent Harness**（[ADR 0048](../adr/0048-agent-harness.md)）作为多 Agent 协作微内核：框架负责权限收窄、守恒预算账本、确定性护栏（Guard Kernel）、串行信箱（Mailbox）、共享黑板（Blackboard）与事件账本（`engagement_events`），由 Agent 自主决定如何协作。

## 1. 在 `agents/<name>/agent.json` 中声明 `collaboration`

每个 Agent 通过 `agent.json` 的 `collaboration` 字段声明允许联系的同伴（`contacts`）、允许接收协作请求的来源（`accepts_from`）以及单次协作预算上限（`budget`）：

```json
{
  "name": "planner",
  "version": "1.0.0",
  "description": "群内协作入口 Agent：拆解需求并协调 builder 与 reviewer",
  "role": "orchestrator",
  "entry_points": ["system.md", "boundaries.md", "conventions.md"],
  "trigger_rules": {
    "file_patterns": [],
    "keywords": ["规划", "方案"]
  },
  "collaboration": {
    "contacts": ["builder", "reviewer"],
    "accepts_from": ["human", "builder", "reviewer"],
    "budget": {
      "modelCalls": 16,
      "tokens": 64000,
      "wallMs": 120000,
      "sideEffects": 8
    }
  }
}
```

## 2. 协作工具与共享黑板

| 工具 | 作用 |
| --- | --- |
| `agents` | 列出当前可联系的 Agent 及其职责说明 |
| `ask` | 同步向 `contacts` 中的同伴提问，在当前回合内等待回复 |
| `delegate` | 异步委派任务，目标完成后将 `result` 投回委派方信箱唤醒新回合 |
| `tell` | 单向通知同伴，不等待回复 |
| `follow_up` | 对已发出的 `ask` / `delegate`（按 `mailId`）追加上下文或继续追问 |
| `board_read` | 读取当前 Engagement 的共享黑板条目（支持按 `key` 或 `kind: note \| todo \| artifact` 过滤） |
| `board_write` | 向共享黑板写入或更新 `note`、`todo`（`pending \| in_progress \| done`）或 `artifact` |
| `cancel_delegation` | 撤回自己委派出去的工作（传 `delegate` 返回的 `mailId`） |
| `escalate` | 冻结当前 Engagement 并向发起的人类请求裁决 |

## 3. 配置多 Bot 群聊场所（`ai.venues`）

在 `zhin.config.yml` 中配置 `ai.venues`，将群场景绑定到多个 Bot Endpoint：

```yaml
ai:
  venues:
    - id: product-room
      conversation:
        platform: sandbox
        sceneType: group
        sceneId: product-room
      visibility: visible
      entry: planner
      members:
        - agent: planner
          botEndpoint: planner-bot
        - agent: builder
          botEndpoint: builder-bot
        - agent: reviewer
          botEndpoint: reviewer-bot
```

| 字段 | 说明 |
| --- | --- |
| `id` | 场所唯一标识 |
| `conversation` | 绑定的会话：`platform`（适配器平台名）、`sceneId` 必填；`sceneType`（`private` / `group` / `channel`）与 `threadId` 可选。同一会话只能绑定一个 Venue |
| `members` | 成员列表，每项是 `agent`（Agent 名）与 `botEndpoint`（该 Agent 发言用的 Endpoint 名），可选 `aliases`（群里点名用的别名）。同一 Venue 内 Agent 与 Endpoint 都不能重复 |
| `entry` | 没有点名特定成员时接管人类消息的入口 Agent，必须是成员之一 |
| `visibility` | 投影模式，不写时私聊为 `backstage`，其余为 `visible` |

- `visible`：每个参与 Agent 通过各自绑定的 Bot 账号在群聊中发言。
- `summary`：协作在后台进行，仅由 `entry` Agent 发送汇总结果。
- `backstage`：纯后台协作，不向群聊投射中间消息。

完整字段见[配置字段（自动生成）](../configuration/generated.md)。跨进程的远程 Agent 通过 [`a2a.mailbox`](../configuration/index.md#mcp-a2a) 接入。

## 4. 使用 `zhin trace` 检视协作

```bash
# 列出最近的 Engagement
zhin trace --engagements --list

# 查看最近一次 Engagement 的协作图
zhin trace --engagements

# 查看指定 Engagement 的完整因果链、黑板快照、护栏阻断与预算消耗（id 可只写前缀）
zhin trace <engagementId>
```

协作事件保存在数据库的 `engagement_events` 表中，需要 SQLite、MySQL 或 PostgreSQL。Console 的协作图谱页面展示同一份数据。

更多说明见 [Agent 与工具调用](./agent.md#多-agent-协作)。
