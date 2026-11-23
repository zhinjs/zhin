---
"@zhin.js/agent": patch
---

**高危确认规则**：判定不变；来源确认卡与审计记录写明是哪条规则、哪些来源触发了确认（#1250 第 95 批 high-risk-rules-explain）。

- 来源确认卡（策略 `external-content-confirmation`）在原因与来源链之后多两行：「规则」写工具被归进哪一类、依据是名字规则还是工具标签、这次用的级别（如「规则：`schedule_add` 被当成定时任务操作（名字规则）；这一类在本回合读过外部内容后需要确认，第一方只读结果不算（untrusted_content）。」，`schedule_preview` 被抬到 `any_content` 时另行说明）；「来源」按类型写每个来源（网页、搜索结果、工作区文件、知识库、已存记录、MCP 服务与工具、子 Agent、第一方只读结果、背景消息条数、识图描述、定时任务提示词），最多 5 个。只写来源类型、工具名、MCP 服务名、条数等元数据，不引用外部内容原文；名称只保留字母、数字和 `_ . : -`；定时任务里存下的未知来源键不原样显示。
- 卡片文字跟随回合的显示语言（`zh-CN` / `en`），原因、来源链与问题里的字段标签（命令、工作目录、目标文件、本次参数、风险）一并本地化；默认中文文案与之前一致。
- 来源确认写的决策审计 `tool_approval` 在 `payload` 里多 `rule`（如 `schedule.name`、`outbound.tag`）、`confirmLevel`、`sourceKinds` 三个字段。
- 文档（`docs/ai/agent.md`、`docs/en/ai/agent.md`）新增「规则速查」三张表：哪些工具算哪一类高危与读取例外、每类在什么级别下确认、哪些东西算读过内容及各自例外；`docs/contributing/development.md` 写明高危确认规则变化在发版说明里单独成条的约定。

没有新增公开 API。
