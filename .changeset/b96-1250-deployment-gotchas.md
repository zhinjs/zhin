---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
---

#1250 第 96 批：部署者知识收回上游（deployment-knowledge-upstream）。

- `schedule_add` 的说明写明何时用它（到点由 AI 生成内容、调用工具，或按日历 cron 运行），只是到点发固定文案的提醒时若有 `reminder_create` 优先用它，提醒必须真正建任务、不要只写进记忆，并说明没有 `cron_add` 工具；`tools` 参数说明写明其实际语义：写明后到点只能用这些工具，省略且没给 `skills` 时按 prompt 关键词自动挑选（可能漏选），只给 `skills` 不给 `tools` 时到点没有任何工具。后一种情况 `schedule_add` 的结果现在带 `warning`。
- `bash`：隔离执行环境（Docker 或其镜像）不可用时，工具返回「Shell is unavailable on this host … Do not retry bash in this conversation」，不再与被沙箱拒绝的单条命令混在一起；`SandboxResult` 新增可选字段 `isolationUnavailable`。bash 可用时行为不变。
- 脚手架生成的 `BOT.md` 与 `zhin migrate` 生成的 `AGENTS.md` 不再写不存在的 `cron_add`，改为说明 `reminder_create`、`schedule_add`、`schedule_update` 的分工。
- 文档：新增「常见问题与反直觉行为」（`docs/operations/gotchas.md`，中英），从生产部署页链接。
