---
"@zhin.js/kernel": patch
"@zhin.js/adapter-lark": patch
---

ScheduleEngine 的 pause/resume 现在同样作用于 every/at 任务（暂停期间不触发、恢复后按原周期继续、不补发）；飞书长连接重复 connect() 时清理旧的健康检查定时器。
