# 引入 Assistant Runtime（路线 A）

Zhin.js 从 **IM 聊天 Bot** 演进到 **个人助手** 时，主动能力（定时、外部事件、智能家居）不能继续作为 `ZhinAgent.process()` 的旁路。采用 **路线 A**：在现有 Agent 执行层之上新增 **Assistant Runtime**，不推倒 IM 栈。

## 背景

当前主动执行分散在三处：

- `PersistentCronEngine` → `data/cron-jobs.json`
- `Scheduler` → `data/scheduler-jobs.json` + `HEARTBEAT.md`
- 插件 `addCron` → 内存，重启丢失

投递依赖手写 `CronJobContext`（platform / endpointId / sceneId），外部系统（Home Assistant webhook 等）无一等公民入口。`TaskQueue`（重试 / DAG / 优先级）已实现但未接入定时路径。

## 决策

1. 新增 **Assistant Runtime** 作为主动任务脊柱：`Job` 统一模型、`JobStore` 持久化、`JobScheduler` 调度、`JobWorker` 执行、`NotificationRouter` 投递。
2. **IM 入站对话** 降级为 Job 的一种 `trigger: im_message`，而非唯一入口。
3. **ZhinAgent / MCP / 多 Agent binding** 保留为执行引擎；智能家居等领域通过 **Domain Service** 封装，MCP 为实现细节。
4. **分阶段迁移**：M1～M5 垂直切片；每个里程碑保持 Stable（minimal-bot）默认行为不变，Advanced 特性 opt-in。

## 非目标（本 ADR 范围内不做）

- 不替换 `@zhin.js/core` 消息调度或出站发送链。
- 不将个人助手设为 Stable 默认产品形态（仍为 Advanced / opt-in）。
- 不在 M1 一次性删除 `cron-jobs.json` / `scheduler-jobs.json`（先双写、后弃用）。

## 分层（目标）

```
Ingress（IM / Cron / Webhook / HA）
    → Assistant Runtime（JobStore / Scheduler / Policy）
        → Execution（ZhinAgent / Subagent / 确定性脚本）
            → Egress（NotificationRouter → Adapter / HA notify / 静默）
```

## 里程碑与破坏性（摘要）

| 里程碑 | 主题 | 用户可见破坏 |
|--------|------|----------------|
| M1 | 统一 JobStore | 无（双写 + 迁移 CLI）；M1 末可选弃用直接写旧 JSON 的 API |
| M2 | Event Ingress | 无；新增 Host HTTP 端点，需配置 token |
| M3 | NotificationRouter | **中**：cron `context` 形状扩展；旧字段仍兼容一个 major |
| M4 | Home Domain | 无；新增 `assistant.home` 配置块 |
| M5 | Assistant Profile | **低～中**：Bootstrap 文件可合并进 profile；旧 markdown 仍可读 |

详细步骤、文件清单与 harness 约束见 [Assistant Runtime 演进路线图](../architecture/assistant-runtime.md)。

## 与现有 ADR 的关系

- **ADR 0004**：出站仍经 `queue-im-field-contract` 规范化；NotificationRouter 的 IM 通道必须走同一契约。
- **ADR 0006**：`assistant.*` 配置遵循约定优先 + deep merge；数组显式写出时完整覆盖。
- **ADR 0002**：IM 入站路由不变；Assistant Runtime 不插入 `message.receive` 管线中间。
