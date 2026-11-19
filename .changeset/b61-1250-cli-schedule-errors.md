---
'@zhin.js/cli': patch
'zhin.js': patch
---

`zhin schedule resume` 被投递目标拒绝（403 `schedule_target_forbidden`）时说明原因（你没有权限向该任务的投递目标发消息，需要哪个账号上的 `endpoint.operate`）并以非零状态退出；`add` / `set-agent` 遇到 `schedule_agent_not_found` 时列出实例返回的可用 Agent（`data.available`）并提示如何改选（zhinjs/zhin#1250 第 61 批）。

`/assistant/jobs` 的 `schedule_target_forbidden` 对没有指明账号（缺 `scene.platform` / `scene.endpointKey`）的投递目标不再拼出「需要 undefined / undefined 上的 endpoint.operate」，改为与 Console RPC 一致的「投递目标需要指明账号」。
