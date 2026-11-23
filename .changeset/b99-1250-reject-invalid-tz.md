---
"@zhin.js/agent": patch
---

**定时任务**：保存时就拒收无效的时区（#1250）。

- `schedule_add`、RPC 添加任务和 `schedule_update` 改计划时，`tz` 必须是运行时（`Intl`，调度器用的也是它）认识的时区：IANA 时区名（如 `Asia/Shanghai`、`Etc/GMT-8`、`UTC`）或 `+08:00` 这类偏移，前后空格会去掉；否则返回「时区无效」，不保存任务。以前这样的值会原样存下，要等任务注册时才失败，而且会在 `schedule_list`、Console 和 CLI 里原样显示。
- Assistant Profile 里某个 routine 无法生成任务时（时区无效、通知配置有误等），跳过这一条并记一条 `profile_routine_invalid` 警告，其他 routine 照常同步（以前一条出错会中断整轮同步）。这条 routine 以前同步过的任务会被停用，并在任务状态里写明原因，不会继续按旧配置运行。
- 已经存下的无效时区不做迁移：这样的任务本来就注册不上，用 `schedule_update` 或 Console 改计划时会提示「该任务保存的时区无效…请删除后重建」，改标签、启停或用 `delay_minutes` 改为一次性任务照常可用。
