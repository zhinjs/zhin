---
"zhin.js": patch
---

**Console 定时任务**：`POST /api/assistant/jobs` 与 `POST /api/assistant/jobs/update` 的 `schedule.atMs` 现在只接受 365 天以内的未来整数毫秒，和 Agent 的 schedule 工具口径一致；更远的时间（包括超过 `Date` 上限 8.64e15 的值）返回 400 `invalid_argument`，不再写进调度器（#1250）。
