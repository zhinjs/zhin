---
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
---

Console 页面现在可以读到群聊插话和技能助手的真实状态：`plugin.root.ambient`（需要 `ambient:read`）和 `plugin.root.skills`（需要 `skills:read`）。只返回最近 24 小时的结果统计，不含聊天内容、提示词或判断理由。插件 RPC 新增 `queries`，可以注册多个只读查询。
