# 后台任务（Detached Task）

> 对应 [#731](https://github.com/zhinjs/zhin/issues/731)（路线图 P5 · M5.1–M5.3）与 [#732](https://github.com/zhinjs/zhin/issues/732)（M5.4–M5.5：插话、改向、叫停与 `/tasks` 命令）。

后台任务是一种能脱离当前回合独立运行的任务：它有自己的 `taskId`、持久化状态机，并且每次工具调用后都会落盘 checkpoint，进程重启后从最后一个 checkpoint 继续执行。

后台任务**默认不启用**：只有调用方显式 `create()` 才会产生任务，现有回合行为不变。

## 状态机

`queued → running → done | failed | cancelled`，另有 `waiting_approval`（等待确认）和 `paused`（暂停）。终态（done / failed / cancelled）不会再迁移；非法迁移抛出 `DetachedTaskTransitionError`。

## 权限

任务权限来自**创建时冻结**的 `turnPolicy` 快照（`shell` / `filesystem`），会被深拷贝并冻结；创建回合之后权限变化、重启恢复、确认后继续，都不会扩大它。未传 `policy` 时为空快照，即没有 shell、没有文件系统权限（与 `DeferredWorkerRunner` 一致）。

## Checkpoint 与恢复

执行器通过 `ctx.step(tool, run, { idempotencyKey })` 执行每个工具调用，每步完成后写入 `DetachedTaskStep`（基于 `@zhin.js/ai/agent-step-checkpoint`）。恢复时执行器从头重放，已 checkpoint 的步骤直接返回保存的结果，不会再次执行。

启动时调用 `runner.recover()`：处于 `running` / `queued` 的任务重新入队并继续；累计恢复超过 `maxResumeAttempts` 次的任务标记为失败并通知用户。

## 幂等键

有副作用的调用应传 `idempotencyKey`，参照 workroom effect ledger 的思路记录 `executing → committed`：

- 已 `committed`：直接返回记录的结果，不再执行。
- 停在 `executing`（重启前可能已执行、也可能没执行）：标记为 `outcome_unknown`，**不会重放**，任务转入 `waiting_approval` 并通过审批通道请用户确认。

## 汇报

进度推送复用 #718 的 `TurnProgressReporter`：按间隔节流、只推送自然语言（工具名、路径、代码会被过滤）。任务完成、失败或需要确认时各推送一条消息。投递失败只记日志，不影响任务。

## 配置

`new DetachedTaskRunner({ store, executors, deliver, config })`，`config` 默认值：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `progressIntervalMs` | `60000` | 两次进度推送的最小间隔 |
| `maxProgressUpdates` | `10` | 单次运行最多推送几次进度 |
| `maxSteps` | `50` | 超过即判定失控并失败 |
| `maxResumeAttempts` | `3` | 重启后自动恢复的最多次数 |

存储使用 `FileDetachedTaskStore(dir)`（每个任务一个 JSON 文件，原子写入），测试可用 `InMemoryDetachedTaskStore`。

## 接入运行时

模块从 `@zhin.js/agent` 导出。拥有执行器的插件创建 `DetachedTaskRunner`，并以 `detachedTaskRunnerToken` 提供给运行时；IM 入口读到后才启用下面的命令与插话路由。没有提供时，入口行为完全不变。创建任务时请传入 `sessionId`（会话键）与 `createdBy`（创建者），命令和插话只作用于本会话、且只有创建者或主人可以操作。插件启动时应调用 `runner.recover()` 恢复未完成的任务。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/tasks` | 列出本会话进行中的后台任务和最近结束的 5 个 |
| `/task stop <id>` | 叫停任务：中止执行，之后不会再产生新的副作用 |
| `/task redirect <id> <新要求>` | 改向：新要求在任务的下一个 step 边界注入 |

## 插话、改向、叫停

本会话有进行中的后台任务时，用户的普通消息先做意图判断：

- **叫停**（`取消`、`停止任务`、`stop` 等）：叫停最近的任务。
- **改向**（以 `改成`、`换成`、`instead` 等开头的明确改向措辞）：作为 steering 排队，任务在下一个 step 边界通过 `ctx.takeSteering()` 取到并调整；记录在 `steeringLog` 中，重启重放时同一边界得到相同内容。
- **其他消息**：照常开启新回合，不影响任务。

规则刻意保守：只有明确的叫停词和改向措辞会被拦截。产品若提供了 `TurnIntentResolver`（或可信的 `turnIntent` 元数据），以它的结果为准：`steer` 视为改向，`new` / `observe` 视为无关；叫停词始终生效。

`cancelGraceMs`（默认 `5000`）：叫停时最多等待执行器退出的时间；超时后任务仍标记为已取消，且执行器无法再开始新的 step。
