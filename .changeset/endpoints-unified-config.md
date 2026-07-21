---
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
---

适配器配置统一为 endpoints 数组格式：`plugins.<adapter>` 为该 adapter 所有 endpoint 的通用配置，`plugins.<adapter>.endpoints[i]` 为单个 endpoint 的特殊配置（逐项覆盖，`name` 必填）。slack / github schema 新增 `endpoints` 属性；icqq / qq / slack 顶层必填改为 `anyOf`（单 endpoint 字段或 `endpoints` 数组二选一，兼容 Ajv strictRequired）。
