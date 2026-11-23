---
"@zhin.js/agent": patch
---

#1250 第 91 批：减少私聊里修改定时任务的确认次数。

- 只读工具不算高危写操作（schedule-list-classified-high-risk）：只凭名称归进「修改配置」「定时任务」类的工具，名称以读取动词结尾（`_list`、`_get`、`_show`、`_status`，如 `schedule_list`、`remind_list`、`config_get`）或工具定义声明了 `readOnly: true` 时不再进这两类，也不再因来源而确认；Host 的 `schedule_list` 声明了 `readOnly: true`。更严的标记优先：类别标签、内置的执行命令 / 写文件 / 外发名称、`risk: 'dangerous'`、`riskCategory`、名称里的写动词（`add`、`update`、`remove`、`pause` 等）照旧归类；`readOnly` 只认工具代码里的声明。这类工具的结果是否算受信输出不变（`schedule_list` 仍算外部内容）。
- 本实例定时任务的干净投递不算背景来源（scheduled-delivery-counts-as-background）：到点运行没有读过任何记录在案的内容、任务也不是读过内容后创建的、不是外部事件任务，且平台回执确认按原文发出一条消息时，这条投递记入进程内的投递记录（按平台消息与文本摘要）；下一回合它作为背景出现时，对任务创建者本人的回合（没有聊天创建者的任务对所有回合）不再算「读过外部内容」。运行中读过外部内容的投递、被改写的投递，以及用户发的同样文字照旧算来源。
- 同一件事一个回合只确认一次（confirm-every-step-no-batch）：同一回合、同一发起人、同一高危类别、同一目标（工具输入定义里声明的 `id` / `target` / `path` 等标识参数，限同一插件；没有时按完全相同的参数）确认过一次后，本回合后续同类调用不再重复确认。目标、类别、发起人不同或进入下一回合都会重新确认；被拒绝、超时的确认不记录；一次确认不会覆盖比它本身更多的授权（只确认意图时普通审批照常进行，需要主人的调用不会被管理员的确认覆盖）；`requiresApproval: 'human'` 的工具每次单独确认。记录只在本回合内存里。
- `schedule_update` 与 `schedule_add` 一样声明 `admin_approvable`（`ADMIN_APPROVABLE_TOOL_TAG`）：开启 `ai.agent.approval.adminSelfApprove` 时，端点层或以上的管理员可在自己的私聊里本人批准一次。

新增公开 API（`@zhin.js/agent`，均为可选字段）：`TaskExecutorDeps.deliveryLedger`、`TaskExecutionResult.contentClean`（继承自 `ScheduleExecutionResult`）、`TurnOutcome` 完成态的 `contentProvenance`、`TurnEndEvent.contentProvenance`。
