---
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/host-http": minor
"@zhin.js/console-protocol": minor
"@zhin.js/cli": patch
---

定时任务（#1250）：持久任务现在记录并显示下次运行时间（`state.nextRunAtMs`）——启动时为已启用的任务重新计算（修复升级后为空的旧数据并记 info），每次运行、`resume` 后都会重新计算，`pause` 清空；已启用却算不出下次运行时间的任务记 warn，并作为「需要你处理」的 `schedule.unschedulable` 条目出现。重启时 assistant profile 同步不再清空任务的运行记录（`state`）与创建时间；`routines.heartbeat.enabled: false`（或 profile 不再声明心跳）会把已持久化的 `assistant-profile-heartbeat` 停用，profile 改变任务启用状态时记 info。`zhin schedule list`、`GET /assistant/jobs` 与 Console `schedule:list` 的持久任务返回 `target: { resolved, display?, reason? }`（账号显示名 + 会话；账号已不存在时 `resolved: false`），CLI 以「⚠ 无效」标出，并显示已启用任务的下次运行时间。`zhin schedule add` 新增 `--target <adapter>:<endpoint>:<kind>:<id>`（省略时沿用 `assistant.defaults.notify` / profile `defaults.notify`）；`--notify-channel im` 缺目标或目标账号不存在时，Host 返回 400 与错误码 `schedule_target_required` / `schedule_target_not_found` / `schedule_target_invalid` 和中文说明，不再是 Internal error。数据库迁移完成后 `data/schedule-jobs.json` 改名为 `schedule-jobs.json.migrated`（记 info）；`schedule_list` 工具描述改为真实存储位置。
