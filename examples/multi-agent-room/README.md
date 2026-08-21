# multi-agent-room

一个 Sandbox Bot 内运行多个 Agent binding 的示例。普通 `spawn_task` 负责聊天内
子任务；它不冒充 Workroom Scheduler 或修改 Run/Task/Assignment 事实。

## 架构要点

- IM 只负责用户输入和结果投递，不承担 Agent 间通信。
- WorkroomKernel 要求显式 Project capability，不从当前 Session 猜 Project。
- 当前切片不发布模型可写的通用 transition 工具，也不把 `spawn_task` 结果隐式写入 Workroom。
- Scheduler、local/remote Executor 与 Acceptance port 将通过独立纵向切片接入。
- 不需要多个 Bot 账号，也不通过群内 `@` 或文本 task ID 传递 Agent 工作。

## 快速开始

```bash
cd examples/multi-agent-room
pnpm install
pnpm dev
```

在 Sandbox 会话中发送：

```
ai: 请调研一个主题，交给 researcher 完成后汇总结论
```
