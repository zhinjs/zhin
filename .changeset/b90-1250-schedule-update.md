---
"@zhin.js/agent": patch
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

#1250 第 90 批：就地修改定时任务与确认卡编号。

- 就地修改定时任务（schedule-update-missing）：新增 Agent 工具 `schedule_update`，按 `id` 修改 `cron`、`schedule_kind`、`delay_minutes`、`label`（空字符串清除）与 `enabled`，任务的 Agent、提示词、投递目标、创建者、执行计划、预算与来源记录一律保持不变；只给 `cron` 时沿用原来的 `schedule_kind`（以及时区、节假日设置），只给 `schedule_kind` 时沿用原来的 cron。谁能修改与 `schedule_remove` / `schedule_pause` / `schedule_resume` 相同（非 owner 只能改自己在聊天里创建的任务，非 IM 来源和 Console / CLI 创建的任务只有 owner 能改，Profile 例程一律指向 Profile 文件）；它与 `schedule_add` 同属定时类高危操作，按写操作确认。`schedule_add` 的说明提示修改已有任务请用 `schedule_update`，不要删除后重建（重建会丢掉隐藏的 Agent 等设置）。`schedule_update` 列入保留工具名（预演里同样没有它）。`@zhin.js/agent`：`TimerScheduler` 新增 `updateJob(id, update)`（重新注册计时并重算下次运行时间；停用等同暂停），新增类型 `ScheduleJobUpdate`，Assistant 运行时 `jobs` 端口新增可选 `update`。修复 `schedule_kind: 'freeDay'` 因大小写归一化退回 `solar` 的问题（`schedule_add` 与 Profile 例程同样受影响）。
- CLI：新增 `zhin schedule update <id> [cron] [--cron <expr>] [--kind <kind>] [--at <iso8601> | --every <interval>] [--label <label>] [--enable | --disable]`，经新路由 `POST /api/assistant/jobs/update`（与其他任务写操作一样需要 `ops.schedule.write`，由已有的 `/assistant/jobs` 前缀规则覆盖）；任务修改后仍会运行且有 IM 投递目标时，与 `resume` / `set-agent` 一样要求该账号上的 `endpoint.operate`（只停用不需要），Profile 例程返回 400 `schedule_update_profile`。成功时输出新的计划、状态与下次运行时间，并说明 Agent、提示词与投递目标未变。
- 确认卡编号不再一直增长（interaction-number-keeps-growing）：同一会话里没有仍在等待回答的卡片时，新卡片的数字按钮从 1 重新编号；仍有待答卡片时，新卡片接着往后编号，不与待答卡片冲突。卡片的提问结束（回答、取消、超时）后即不再占用编号；已结束卡片的旧编号在过期前仍会被认出并提示已过期，新卡片的同号按钮优先。
