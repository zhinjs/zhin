# Multi-Agent Room (`ai.venues` + Agent Harness)

3 个 Bot（`planner` / `builder` / `reviewer`）在同一个群聊（`sandbox:group:product-room`）中协作的示例（ADR 0048 Agent Harness）。

## 架构与配置

### 1. 声明式协作边界（`agents/<name>/agent.json`）

每个 Agent 在 `agent.json` 的 `collaboration` 字段中声明允许联系的对象（`contacts`）、允许接收消息的来源（`accepts_from`）与单次协作预算（`budget`）：

```json
{
  "name": "planner",
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

### 2. 群聊场所投影（`zhin.config.yml` `ai.venues`）

`ai.venues` 将群场景 `group:product-room` 绑定为 `visible` 模式场所，入口为 `planner`，并为每个参与 Agent 绑定各自的 Sandbox Endpoint：

```yaml
ai:
  venues:
    - id: product-room
      adapter: sandbox
      scene: group:product-room
      mode: visible
      entry: planner
      participants:
        planner: sandbox:planner-bot
        builder: sandbox:builder-bot
        reviewer: sandbox:reviewer-bot
```

- `visible`：每个参与 Agent 在协作回合中的发言与结果通过各自绑定的 Bot Endpoint 投射到群聊，对群成员可见。
- `summary`：协作在后台完成，仅由入口 Agent 向群聊发送汇总消息。
- `backstage`：纯后台协作，不在群聊中投射中间过程。

### 3. 协作工具与共享黑板（Blackboard）

- `ask`：同步向 `contacts` 中的同伴提问并等待回复。
- `delegate`：异步委派子任务，完成后以 `result` 邮件唤醒委派方。
- `tell`：单向通知同伴，不等待回复。
- `board_write` / `board_read`：在同一 Engagement 内读写带版本号的共享黑板（`note` / `todo` / `artifact`），例如 `planner` 写入 `plan`、`builder` 写入 `draft`、`reviewer` 写入 `review`。
- `escalate`：遇到权限越界或高风险决策时冻结当前 Engagement 并交由人类裁决。

## 运行与追踪

```bash
# 运行本示例契约测试
pnpm --filter multi-agent-room test

# 启动开发模式
pnpm --filter multi-agent-room dev

# 查看最近一次或指定 Engagement 的协作因果链、黑板快照与预算消耗
zhin trace
zhin trace <engagementId>
```
