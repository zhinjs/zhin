---
"@zhin.js/gateway": patch
---

插件配置校验信息（`zhin config set`、Console 表单）按项目 `locale` 输出完整的中文 / 英文文本：除 `type` 外，`maximum` / `minimum` / `exclusiveMaximum` / `exclusiveMinimum` / `minLength` / `maxLength` / `enum` / `const` / `pattern` / `required` / `additionalProperties` / `format` / `minItems` / `maxItems` 也已本地化，消息中写明字段路径；`additionalProperties` 的错误路径指向多出的字段。其他关键字回退为带 Ajv 原文的本地化提示（#1250）。
