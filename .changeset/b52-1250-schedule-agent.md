---
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

定时任务可以指定由哪个 Agent 执行（#1250 第 52 批 `schedule-agent-no-creation-path`）。运行时早已支持 `action.agent`，但没有任何入口能设置它，只能停服改数据库 `agent_schedule_jobs.agent`。不指定 Agent 时行为不变（默认 `zhin`）。

- CLI：`zhin schedule add --agent <名称>`；新增 `zhin schedule set-agent <id> <名称>` 与 `set-agent <id> --clear`（恢复默认）。`zhin schedule list` 每个任务多一行 `Agent:`（未指定时为「zhin（默认）」）。
- 实例接口：`POST /api/assistant/jobs` 接受可选 `agent`；新增 `POST /api/assistant/jobs/set-agent`（`{ id, agent }`，`agent: null` 清除）。名称必须是已配置的 Agent（`zhin` 与 `ai.agents` 的键），否则 400 `schedule_agent_not_found`，错误里列出可用的 Agent；心跳任务不能指定 Agent。权限沿用 `ops.schedule.write`。`GET /api/assistant/jobs` 新增 `agents`（可用的 Agent 名称）。
- Console RPC：`cron:add` 接受可选 `agent`（同样校验）；新增 `cron:set-agent`（`ops.schedule.write`，已登记到 `CONSOLE_RPC_PERMISSIONS`）；`schedule:list` 的持久化任务行新增 `agent`，返回值新增 `agents`。`ConsoleScheduleEngine` 新增可选 `listAgents()` / `setJobAgent()`。
- 对话工具：`schedule_add` 新增可选参数 `agent`，`schedule_list` 的持久化任务带 `agent`。聊天里只能指定当前会话里自己能用的 Agent：与 `@名称` 点名时的可见范围相同（Agent 包的 `platforms` / `scopes` / `permissions` 过滤），外加默认的 `zhin`；看不到的 Agent 与不存在的一样被拒绝。不在运行时回合内调用（如外部工具协议）时只接受默认 Agent。
- `@zhin.js/agent`：`AgentTurnConfiguration` 新增可选 `availableAgents`（回合内可见的专家 Agent 名称）；`TimerScheduler` 新增 `setJobAgent()`；`AssistantRuntimeHandle.jobs` 新增可选 `agents()` / `setAgent()`；`ScheduleManager` 新增可选 `agents`；`ScheduleAddInput` 新增可选 `agent`。
- 文档：CLI 与 Agent 文档（中英文）补充 `--agent`、`set-agent` 与聊天里的权限规则。
