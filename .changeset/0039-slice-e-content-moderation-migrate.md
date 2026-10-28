---
"@zhin.js/core": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-content-moderation": patch
---

feat(group-rules): ADR 0039 切片 E — content-moderation 迁移到群规执行器（有意的行为收紧）

- content-moderation 只判定广告 / 辱骂，判定后经新的 `groupRuleViolationToken`（`@zhin.js/core/runtime`，Agent host 提供）交给群规执行器；插件自身不再调用平台禁言 / 踢人。
- 迁移：`groupModeration` 名单里的群首次有消息时，按默认模板「提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟」为广告、辱骂各生成一条**待确认**规则并在群里出预览卡；**群主 / 管理员确认前只提醒 / 警告，不再自动禁言**。未装 Agent 时插件也只提醒 / 警告。
- **新人发广告不再直接踢**：入群 10 分钟内的明确广告改为出一张踢人审批卡（每次人批），驳回或超时不踢。
- 升级须知：原先自动禁言 / 踢人的群，升级后需群主或管理员在群里发 `/rule approve <短码>`（或 Console 批准）一次才恢复自动禁言；踢人始终逐次人批。
