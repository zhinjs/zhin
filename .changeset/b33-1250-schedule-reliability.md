---
"@zhin.js/agent": minor
"@zhin.js/cli": patch
---

定时任务可靠性（zhinjs/zhin#1250 第 33 批；工作日 9:00 天气早报没发出来）：

- `schedule-empty-plan-no-tools`：执行计划里 `tools` / `skills` 都为空时（`schedule_add` 只带了 `execution_plan.prompt` 或 `refined_prompt`），到点不再拿到空工具列表，而是和没有计划的任务一样按提示词自动挑选工具；trace 的 `capability_resolution` 记 `resolvedBy: affinity` 并带 `warnings: ["empty_execution_plan"]`，一个工具都没选到时带 `no_tools` 并写一条 warn 日志。`schedule_add` 仍接受空计划（不破坏已有任务和调用方），但在结果里提示先用 `schedule_preview` 预演。
- `schedule-tools-blocked-unattended`（所有者已批准纳入本批）：`execApprovalMode: auto` 时，无人值守回合（定时任务）的审批请求交给已有的自动审核 Agent，只有批准才执行；审核拒绝、要求转问人、超时或出错一律拒绝（fail closed），不会去问任何人，结果写进 trace（`unattended_review`）。`ask` / `bypass` 下行为不变，仍直接拒绝；`requiresApproval: 'human'`、危险工具硬闸和「读取外部内容后的高危动作」确认在无人值守时仍一律拒绝。插件工具声明 `readOnly: true` 后，在默认 `on-risk` 下不再要求审批；只读只放宽这一项，不绕过角色 / 信任过滤、ExecPolicy、FilePolicy、网络白名单和硬闸；显式写的 `requiresApproval: always | once | human` 优先；写文件、执行命令、发消息、写记忆、改配置的内置工具（含插件里同名的工具）、带 `shell` / `outbound` / `config` / `schedule` 类别或 `risk: 'dangerous'` 的工具声明只读也不生效。`schedule_preview` 的结果新增 `unattended_approval`，列出到点会被拒的工具和要交给自动审核的工具。
- `schedule-failed-run-marked-ok`：一次运行用了兜底文案、没有任何工具结果且回复为空、或有工具被拒时，任务状态记为 `degraded`（未完成），`last_error` 写明原因、相关工具和 `zhin trace <回合 id>`；不重试（回复已送达）。开启 `notifyOnFailure` 时发「[任务未完成]」提醒；送达的回复本身就是兜底说明时不重复提醒。`zhin watch` 显示 `last:degraded` 和原因，`zhin schedule list` 新增「上次」一行。
- `empty-reply-fallback-misleading`：模型没有给出回复时，兜底文案按实际原因区分：没有可用工具 / 哪个工具被拒（不再把给模型的拒绝原文发给用户）/ 模型空回复。定时任务的兜底文案带任务名、任务 id 和 `zhin trace <回合 id>`，不再建议 `/reset`；普通对话的空回复文案不变。
- `unexecuted-tool-notice-name-mangled`：给模型的「未执行」工具结果里，工具名改用行内代码（`` `api60s__skill__60s-life__weather` ``），模型照抄时 Markdown 不会再吃掉 `__`。
