---
"zhin.js": patch
"@zhin.js/console-protocol": patch
---

功能矩阵不再只有适配器一行（#1250）：`feature.matrix` 在项目根插件提供了命令 / 组件 / 工具时加一行 `kind: 'root'`、`plugin: ''`、`readOnly: true` 的「本项目」行（始终启用，不可开关），列出 `capabilities: { commands, components, tools }`（如 `hello`、`card`）；其他行新增 `kind: 'plugin' | 'adapter'` 与各自的 `capabilities`，按 根插件 → 插件 → 适配器 排序。`feature.list` 的条目同样带 `kind` 与 `capabilities`（不含根插件行）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureKind`、`ConsoleFeatureCapabilities`，`ConsoleFeatureSummary` / `ConsoleFeatureMatrixRow` 新增可选字段。
