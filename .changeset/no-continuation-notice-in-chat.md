---
"@zhin.js/agent": patch
---

Stop prefixing chat replies with "（任务步骤较多，已自动续跑 N 次）" after an automatic continuation. A group member does not announce how many steps a task took; non-IM callers (HTTP, Console) still get the notice.
