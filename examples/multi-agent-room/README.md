# multi-agent-room

一个 Sandbox Bot 内运行多个 Agent binding，并启用持久化 Workroom 基础设施的示例。
普通聊天里的 `spawn_task` 仍只负责会话内子任务；它不冒充 Workroom Scheduler，
也不会修改 Run/Task/Assignment 事实。

## 架构要点

- IM 只负责用户输入和结果投递，不承担 Agent 间通信。
- WorkroomKernel 要求显式 Project capability，不从当前 Session 猜 Project。
- Workroom Project、成员和群/频道绑定由持久化 **Workroom Catalog** 管理，不写入 `ai.workrooms`，保存后无需重启。
- SQLite 保存 Session、Workroom Journal 与 Catalog；进程重启后从数据库恢复。
- local/remote Executor 只能提交 typed observation，Task 状态仍由 Workroom Kernel 的 CAS Journal 推进。
- 模型不能直接调用通用 transition Tool；控制操作走 role-scoped typed port。
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

这条消息走普通聊天 Agent。要测试持久化 Workroom，请先在 Console 的 Workroom
页面创建 Project，把 `sandbox:assistant-bot` 对应的协作空间绑定到该 Project，
并将入口 Agent 设为具有 `orchestrator` 角色的成员。Catalog 修改使用 revision CAS
直接生效，不会改写配置文件或触发运行时重启。

首次提交 `/work` 前，还要在 Console 的 **规划能力配置** 中完成诊断和初始化。为
Console full token 配置 `principalId`，把同一 principal 同时加入 Project `sponsors`
和 `ai.workroom.trustedPackPublishers`（该进程策略变更后需重启）。每个角色使用独立
的 `ai.agents` binding；随后“初始化规划能力”会发布并激活首个 Profile 与 Planning
Policy。
