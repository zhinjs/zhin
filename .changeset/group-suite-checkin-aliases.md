---
"@zhin.js/plugin-group-suite": patch
---

group-suite: add compatibility aliases `checkin do` / `签到` (→ `checkin`), `checkin streak` (→ `mypoints`) and `checkin rank` (→ `rank`), so `checkin rank` no longer falls through to a check-in. 为签到命令增加兼容别名，方便从本地 `checkin <子命令>` 插件迁移。
