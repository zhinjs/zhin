# multi-agent-room

3 个 Bot（coordinator / researcher / writer）在同一个群里协作的示例，也是 Room 核心（`@zhin.js/workroom`，阶段 B）的端到端验收。

> **当前状态：示例内组装，默认运行时未接入。** Room 核心由 `src/team.ts` 在示例内组装，只在测试里驱动；
> `zhin runtime start` 仍使用旧机制，接入默认运行时是 C1 / C2 的工作。旧 Workroom 机制（`src/workroom/**`、`workroom-runtime/**`）
> 与新 Room 并存，删除放在 C 阶段处理。

## 场景

人类在群里提一个请求，三个 Bot 各用自己的账号发言，按角色接力：

| 成员 | 角色 | 做什么 | 可以交给 |
|------|------|--------|----------|
| coordinator | coordinator | 拆解请求 | researcher |
| researcher | researcher | 调研 | writer |
| writer | writer | 成稿并完成 Task | 无 |

## 消息流

```
人类消息（3 个 Bot 各收到一份）
  -> 入站去重 + Room Router 选中 coordinator（hasRoom / route）
  -> team.route()：创建 Task 并指派，成员 turn 进入 Room 串行队列
  -> 成员 turn：start -> 脚本化回复经共享发送限流器发到群里
  -> handoff：护栏检查 -> Task 事件 task.handoff -> Room Bus
       -> 群内可见投影（@下一位成员，走正常发送链）
       -> Bus 订阅者在当前 turn 返回后唤醒下一位成员
  -> writer complete，Task 变为 done
```

要点：

- **协作走进程内 Room Bus，群消息只是展示。** 成员不依赖读取其他 Bot 的群消息，所以平台回显（self / member 来源）不会触发任何 turn。
- **所有出站只有一条路径**：成员回复、handoff 投影、求助消息都经 `RoomSendLimiter.send` -> `ImRuntime.send` -> 渲染 -> Endpoint；示例不直接调用 `endpoint.send` 或 `bot.$sendMessage`。
- Task 状态由事件溯源状态机推进：`task.created -> task.assigned -> task.started -> task.handoff -> ... -> task.completed`。

## 护栏

| 护栏 | 行为 |
|------|------|
| handoff 深度（`maxHandoffDepth`） | 超限则不 handoff，Task 改为 `blocked`，由当前成员的 Bot 在群里 `@人类` 求助，不唤醒下一位 |
| 弹跳（`maxPingPong`） | 同一对成员之间来回过多，同样处理 |
| turn 上限（`maxTurnsPerMinute`） | 超限的 turn 被拒绝（`turn_rate`），记入 `team.failures` 并在群里提示，不静默 |
| 串行发言 | 同一 Room 任意时刻只有一个 turn 在跑，其余 FIFO 排队 |
| 人类取消 | 任意人类可打断当前 turn；清队列与取消 Task 只允许 `sensitiveAccounts` 中的账号 |
| 角色检查 | Task authorizer 的 `next` 校验成员身份与 `handoffTo`；`assign` 只允许 coordinator，缺省拒绝 |
| 账号级限流 | `createRoomSendLimiter` 按 Bot 账号计数，成员回复与 Bus 投影共用同一实例 |

## 运行端到端测试

不访问网络，不使用真实 LLM，不依赖墙钟（假时钟 + 手动 deferred + 脚本化成员）：

```bash
pnpm vitest run examples/multi-agent-room/tests
```

- `tests/room-collaboration.e2e.test.ts`：主流程、回显安全、各项护栏、账号限流、`outboundMiddleware()` 与 `defineMiddleware` 的类型兼容。
- `tests/support/sandbox-im.ts`：Sandbox 形状的适配器 fixture（真实 `ImRuntime` + 3 个 Endpoint + Peer Registry）。
- `tests/multi-agent-room-contract.test.ts`：配置与文档契约。

## 文件

- `src/room.ts`：Room 定义（`buildRoomDefinition`）与校验后的注册表。
- `src/team.ts`：`createRoomTeam()`，把 Room 核心组装起来（C1 接线样板）。
- `agents/<coordinator|researcher|writer>/`：三个角色的 Agent 说明文件（示例内容）。
- `zhin.config.yml`：三个 Sandbox Endpoint（`coordinator-bot` / `researcher-bot` / `writer-bot`）。

## C1 接线备忘

- Task 订阅者的分发可能交错：唤醒下一位成员时按 `event.sequence` 排序或去重（本示例用 handoff 事件的 sequence 做水位）。
- 同一 Bot 账号的所有出站（回复、投影、`$reply`）必须共用一个限流器实例，且同一路径只用 `send` 或 `outboundMiddleware()` 中的一种形态。
- `authorize` 同步且看不到 Task 视图，角色检查（`next`）必须由接线方提供；`authorizeAssign` 只给 coordinator。
- Bus 订阅者不要在 turn 内 `await` 同一 Room 的 `runExclusive`（会死锁），应排队后让 turn 先返回。

## 旧机制

持久化 Workroom Catalog、`spawn_task` 与 Project 协作属于旧机制，文档见仓库内 `docs/authoring/conventions.md` 与 `docs/ai/agent.md`。
