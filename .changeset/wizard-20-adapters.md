---
"@zhin.js/scaffold-wizard": minor
---

适配器向导入口补全至 20 个：新增 line / wecom / weixin-ilink（字段式）与 napcat / onebot12 / milky / satori（自定义 configure，按 connection 分流 endpoint 字段）；字段 scope 分层对齐定稿 schema（凭据进 `endpoints[0]`，共享字段留顶层），产出经 Ajv strict 对照全部 20 个 schema 校验。
