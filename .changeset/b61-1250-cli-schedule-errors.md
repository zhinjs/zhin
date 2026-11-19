---
'@zhin.js/cli': patch
---

`zhin schedule resume` 被投递目标拒绝（403 `schedule_target_forbidden`）时说明原因（你没有权限向该任务的投递目标发消息，需要哪个账号上的 `endpoint.operate`）并以非零状态退出；`add` / `set-agent` 遇到 `schedule_agent_not_found` 时列出实例返回的可用 Agent（`data.available`）并提示如何改选（zhinjs/zhin#1250 第 61 批）。
