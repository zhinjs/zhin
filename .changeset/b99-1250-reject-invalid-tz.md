---
"@zhin.js/agent": patch
---

**定时任务**：保存时就拒收无效的时区（#1250）。

- `schedule_add`、RPC 添加任务和 `schedule_update` 改计划时，`tz` 必须是运行时认识的 IANA 时区名（如 `Asia/Shanghai`、`Etc/GMT-8`、`UTC`），否则返回「时区无效」，不保存任务。以前这样的值会原样存下，要等任务注册时才失败，而且会在 `schedule_list`、Console 和 CLI 里原样显示。
- Assistant Profile 里某个 routine 的时区无效时，跳过这一条并记一条 `profile_routine_invalid` 警告，其他 routine 照常同步。
- 已经存下的无效时区不做迁移：这样的任务本来就注册不上，用 `schedule_update` 改计划时会提示时区无效，可以删除后重建。
