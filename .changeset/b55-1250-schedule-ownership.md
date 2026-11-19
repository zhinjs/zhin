---
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
"zhin.js": patch
---

#1250 第 55 批：定时任务权限收紧。

**行为变化：普通用户在聊天里只能看到、管理自己的任务。**

- 聊天工具 `schedule_list`：所有者（`owner` 角色）照旧看到全部持久化任务；其他人（群管理员也一样）只看到自己在聊天里创建的任务（同一用户、同一平台账号，与 `createdBy` 记录的规则相同）和投递到当前会话的任务，不再看到别人的提示词、投递目标与 Agent。任务指定的 Agent 不在当前会话可用的 Agent（`@名称` 可见范围加默认 `zhin`）之内时，只显示「其他 Agent」（`agent_hidden: true`）。插件内存任务（只有插件名与 cron）照常列出。
- 聊天工具 `schedule_remove` / `schedule_pause` / `schedule_resume`：所有者可以管理任何任务；其他人只能管理自己创建的任务，别人的任务只得到「这不是你创建的任务」，不透露内容。Console / CLI / Profile 创建的任务（没有 `createdBy`）只有所有者能在聊天里管理。Profile 例程（`source: profile`）在聊天里一律不能删除、暂停或恢复（重启会还原），提示去 Profile 文件（`assistant.profile.file`，默认 `assistant.profile.yml`）修改。
- Console `cron:resume` 与 `POST /api/assistant/jobs/resume`：恢复后任务会再次投递，因此与 `cron:add` / `cron:set-agent` / `POST /api/assistant/jobs` 一样，任务有 IM 投递目标时要求该账号上的 `endpoint.operate`，否则 403 `schedule_target_forbidden`（RPC：`data.code` / `data.status: 403`）。暂停与删除仍只需 `ops.schedule.write`。
- Agent 不存在时，`cron:add`、`cron:set-agent` 与 `POST /api/assistant/jobs`、`POST /api/assistant/jobs/set-agent` 的错误新增 `data: { code: 'schedule_agent_not_found', agent, available }`，错误文本不变。
- Profile 例程写的 Agent 不在配置中（`zhin` 与 `ai.agents`）时，启动同步记一条警告日志 `profile_routine_agent_missing`；任务照常同步。`syncProfileRoutinesToStore` 新增可选的第三个参数 `{ agents }`。
