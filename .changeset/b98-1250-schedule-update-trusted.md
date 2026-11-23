---
"@zhin.js/agent": patch
---

**高危确认规则**：同一回合里连续两次用 Host 自带的 `schedule_update` 修改同一任务，只确认一次（#1250）。

- `schedule_update` 的结果不再回显本次调用没有设置的标签（主人可以修改别人的任务，标签可能是别人写的）：只有本次调用给了 `label` 时才带上这个值（清除标签时为 `null`）。结果里的计划只保留结构化字段，事件任务的 `eventId` / `source` / `eventType` 等文字不再回显，完整内容请用 `schedule_list` 查看。
- Host 自带的定时任务写工具（`schedule_add`、`schedule_update`、`schedule_remove`、`schedule_pause`、`schedule_resume`）的定义带上 `trusted_output` 与新增的 `untrusted_failure` 标签：成功结果只含框架生成的结构化数据和本次调用给出的值，不再记为外部内容，所以确认之后再改同一任务会沿用确认；调用失败（返回错误或抛错）时，错误文字仍按外部内容记，下一次调用重新确认。豁免按工具定义判断，插件提供的同名工具不受影响；`schedule_list` 与 `schedule_preview` 的结果仍算外部内容。
