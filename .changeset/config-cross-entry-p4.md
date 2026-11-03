---
"@zhin.js/cli": patch
---

可信项目补丁（`config:patch-project`，即 `zhin config set/unset`）的冲突回显在 Schema 无法证明安全的分支下整体打码：`if`/`then`/`else`、`not`、`contains`、`dependencies`/`dependentSchemas`、`unevaluated*`、动态引用、嵌套 `$id` 资源与非本地 `$ref` 不再回显原值，与聊天字段策略的证明边界一致；`config get`/`list` 读取打码规则不变。新增 Console + CLI + IM 跨入口集成回归（三方 CAS、离线保存后 Console 应用、生效结果未确认的一致性）。
