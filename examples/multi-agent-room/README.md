# multi-agent-room

一个 Sandbox Bot 内运行多个 Agent binding 的编排示例。用户只面对一个 IM
Endpoint；Planner 通过 OrchestrationKernel 把任务交给 Researcher，Kernel 保存
Run/Task/事件事实，最终结果仍由原会话投递。

## 架构要点

- IM 只负责用户输入和结果投递，不承担 Agent 间通信。
- `orchestration_add_task(executor="local", assigned_to="researcher")` 直接选择配置好的 Agent binding。
- `remote_mesh` 只用于真正的 A2A 远程 Agent。
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
