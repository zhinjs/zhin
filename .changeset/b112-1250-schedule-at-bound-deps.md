---
"zhin.js": patch
"@zhin.js/cli": patch
---

**Console 定时任务**：`POST /api/assistant/jobs` 与 `POST /api/assistant/jobs/update` 的 `schedule.atMs` 现在只接受 365 天以内的未来整数毫秒，与 Agent schedule 工具的 365 天上限相同；更远的时间（包括超过 `Date` 上限 8.64e15 的值）返回 400 `invalid_argument`，不再写进调度器（#1250）。

**CLI**：`zhin schedule add --at` / `zhin schedule update --at` 在本地按同样的 365 天上限检查，超过时直接报错退出，不再发请求（#1250）。
