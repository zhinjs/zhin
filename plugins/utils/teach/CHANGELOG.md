# Changelog

## 0.0.3

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.0.2

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.0.1

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 1.0.0 (2026-03-05)

### Features

- 精确匹配问答：`teach <问题> <回答>`
- 正则匹配问答：`teach-regex <正则> <回答>`
- 删除问答：`forget <问题>`
- 分页查看列表：`teach-list [页码]`
- 模板变量支持：`{sender}`, `{sender.id}`, `{time}`, `{date}`, `$1`/`$2`
- 上下文隔离（群聊 / 全局）
- 冷却机制防刷
- 每群数量限制
- 数据库持久化
- AI 工具集成：`teach_query`, `teach_stats`
- Skill 技能声明
