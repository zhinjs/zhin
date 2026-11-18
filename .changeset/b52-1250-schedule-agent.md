---
"@zhin.js/agent": minor
"@zhin.js/host-http": minor
"@zhin.js/console-protocol": minor
"zhin.js": minor
"@zhin.js/cli": minor
---

定时任务可以指定由哪个 Agent 执行（#1250 第 52 批 `schedule-agent-no-creation-path`）。运行时早已支持 `action.agent`，但没有任何入口能设置它，只能停服改数据库 `agent_schedule_jobs.agent`。不指定 Agent 时行为不变（默认 `zhin`）。

- CLI：`zhin schedule add --agent <名称>`；新增 `zhin schedule set-agent <id> <名称>` 与 `set-agent <id> --clear`（恢复默认）。`zhin schedule list` 每个任务多一行 `Agent:`（未指定时为「zhin（默认）」）。
- 实例接口：`POST /api/assistant/jobs` 接受可选 `agent`；新增 `POST /api/assistant/jobs/set-agent`（`{ id, agent }`，`agent: null` 清除）。名称必须是已配置的 Agent（`zhin` 与 `ai.agents` 的键），否则 400 `schedule_agent_not_found`，错误里列出可用的 Agent；心跳任务不能指定 Agent。权限沿用 `ops.schedule.write`。`GET /api/assistant/jobs` 新增 `agents`（可用的 Agent 名称）。
- Console RPC：`cron:add` 接受可选 `agent`（同样校验）；新增 `cron:set-agent`（`ops.schedule.write`，已登记到 `CONSOLE_RPC_PERMISSIONS`）；`schedule:list` 的持久化任务行新增 `agent`，返回值新增 `agents`。`ConsoleScheduleEngine` 新增可选 `listAgents()` / `setJobAgent()`。
- 对话工具：`schedule_add` 新增可选参数 `agent`，`schedule_list` 的持久化任务带 `agent`。聊天里只能指定当前会话里自己能用的 Agent：与 `@名称` 点名时的可见范围相同（Agent 包的 `platforms` / `scopes` / `permissions` 过滤），外加默认的 `zhin`；看不到的 Agent 与不存在的一样被拒绝。不在运行时回合内调用（如外部工具协议）时只接受默认 Agent。
- `@zhin.js/agent`：`AgentTurnConfiguration` 新增可选 `availableAgents`（回合内可见的专家 Agent 名称）；`TimerScheduler` 新增 `setJobAgent()`；`AssistantRuntimeHandle.jobs` 新增可选 `agents()` / `setAgent()`；`ScheduleManager` 新增可选 `agents`；`ScheduleAddInput` 新增可选 `agent`。
- `set-agent`（CLI / `POST /api/assistant/jobs/set-agent` / `cron:set-agent`）与创建时一样检查任务投递目标账号上的 `endpoint.operate`，没有时 403 `schedule_target_forbidden`（RPC：`data.code` 同名、`data.status: 403`）；`cron:add` 的同一拒绝也带上这个 `data`。
- Profile 例程（`source: profile`）拒绝 `set-agent`（400 `schedule_agent_profile`，错误里说明去 Profile 文件改）：它们每次启动按 Profile 重新声明，原地修改会被静默还原。Profile 的 cron 例程新增可选 `agent` 字段，同步时写入 `action.agent`。心跳任务的拒绝码为 `schedule_agent_heartbeat`；调度器抛出的这两类拒绝在 HTTP 路由返回 400，不再是 500。`TimerScheduler.setJobAgent()` 对这两类抛 `ScheduleJobAgentError`（带 `code`）。
- Agent 已从 `ai.agents` 删除的任务：`zhin schedule list` 标出「⚠ Agent 不存在」；`schedule:list` 的持久化任务行带 `agentMissing: true`；`schedule_list` 工具带 `agent_missing: true`。
- 文档：CLI 与 Agent 文档（中英文）补充 `--agent`、`set-agent`、Profile 例程的 `agent`、聊天里的权限规则（可见性只在创建时检查，撤销权限后任务仍由原 Agent 执行）。
- `TimerScheduler.stop()` 等正在进行的任务写完状态、投递与历史再返回（以前只等队列，关闭存储或删除数据目录时可能还有写入）。
