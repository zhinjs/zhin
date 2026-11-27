---
"@zhin.js/cli": patch
"@zhin.js/agent": patch
"@zhin.js/core": patch
"@zhin.js/kernel": patch
"zhin.js": patch
"@zhin.js/adapter-slack": patch
---

**周期任务间隔上限、`zhin packages list` 的框架包、确认卡遗留问题**（#1250 b113）。

- 周期任务（`every`）的间隔最多 365 天，与一次性任务的上限相同，在保存前拒绝：Console / `POST /api/assistant/jobs`（含 `jobs/update`）返回 400 `invalid_argument`「执行间隔（schedule.everyMs）最多 365 天」；`zhin schedule add/update --every` 在本地报错「执行间隔（--every）最多 365 天（与实例的上限相同）」、不发请求（`0s` 这类不足 1 秒的间隔也在本地拒绝）；`TimerScheduler.addJob` / `updateJob` 以 `schedule_invalid` 拒绝「执行间隔（everyMs）最多 365 天」，任务不保存、原有计划不变；Profile 的 `routines.heartbeat.everyMs` 超出（或不是数字）时启动日志给出警告「配置超限，已停用 heartbeat」且不同步该任务，以前同步过的 heartbeat 任务被停用并记录原因，不再按旧间隔继续运行；`validateAssistantProfile` 报告的就是 `scheduleEveryMsError` 的原文（超限或不是数字）。`scheduleEveryMsError` 只是共用的 365 天上限（另拒绝非数字），正数、整数由各调用方检查，文案与实现一致。内核 `ScheduleEngine.register('every', …)` 遇到会让下次运行时间超出 `Date` 范围（8.64e15）的 `everyMs`（含 `Infinity`）时抛出 `RangeError`、不登记该任务。以前过大的间隔会先保存，之后下次运行时间变成 Invalid Date。
- `zhin packages list` 把 `@zhin.js/core` 与 `zhin.js` 一起归入「Zhin 框架与功能包」，不再算作插件：两者虽然声明 `zhin.type: "plugin"`，运行时把它们当作平台本身（特性载体与安装门面），Console 也从不把它们列为插件。网关 `gateway.packages.list` 的 `kind` 保持按 `zhin.type` 报告（契约取值仍为 `plugin | feature | library`）。
- 旧的工具审批路径（`requiresApproval` 走 `runToolApprovalGate`）的确认卡把工具名与参数原样拼进 Markdown；现在两者都按其他审批卡的方式以行内代码原样显示（`markdownLiteral`），参数中的密钥打码，链接、图片、标题、HTML 与 `<@…>` 提及都不会生效。显示规则与主审批卡一致：有命令 / 工作目录 / 目标文件时各占一行；`human` 策略或参数里既没有命令也没有路径时显示打码后的完整参数（以前只有 `human` 才显示参数，其他策略下等于盲批）。
- 审批卡参数打码（`redactApprovalDisplay`）对嵌套超过 8 层的对象 / 数组显示 `[max depth]`，与 `redactDecisionPayload` 一致；以前原样返回，深层的密钥会明文显示。
- 交互卡片（确认 / 选择 / 审批）判断「选项列表已在正文里、不显示按钮」时不再在描述文字里搜「1. 选项名」：模型写的编号列表或审批问题里引用的参数与选项同名时，按钮曾被误删。现在只有 `projectUserInteraction` 真的把编号选项列表放进正文时（选项带说明）才省略按钮（`UserInteractionView.optionsInDescription`）。
- Slack：超过一条消息块数上限的长卡片，按钮全部放在最后一条、与正文末尾同一条消息，后续各条留在卡片原来的会话里（以前会自动建成第一条消息的话题，按钮进入话题后点击到达的是另一个会话，等待中的确认收不到回答）；每条都带自己的通知文字，不再是空白。编辑长卡片时截掉正文、在截断处加「[内容过长，已截断]」并保留按钮（以前超出部分连同按钮一起丢弃）；编辑只修改多条中的第一条。按钮行较多（如 25 行以上）且正文较长时，最后一条不再超出 48 块上限：最后一条只放能和按钮一起装下的正文；按钮行多到放不下正文时按原顺序拆分。不需要拆分时块顺序保持不变（以前按钮会被挪到末尾）。详见 `docs/adapters/slack.md`「长消息与卡片拆分」。
