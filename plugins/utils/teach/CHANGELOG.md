# Changelog

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
