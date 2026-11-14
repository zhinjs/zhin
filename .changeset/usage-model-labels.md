---
"@zhin.js/gateway": minor
"zhin.js": minor
"@zhin.js/cli": patch
"@zhin.js/agent": patch
---

Token 用量（#1250）：`plugin.root.usage-stats` 与 `zhin usage report` 按（服务, 模型）合并行，`services:<id>` 与 `accounts:<id>` 两条记录路径不再拆成两行，并给出「服务名 · 模型」显示名（RPC 行新增可选 `displayName` / `providerLabel` / `providerIds`，顶层新增 `modelLabels`）；读不到服务名时只显示模型名。两个输入总数分别标注口径（`totals.inputBasis: 'reported-all-calls'`，新增 `inputBreakdown`：首次请求估算含 `other` 与对应的真实输入）。日期 / 小时分桶按请求 `timeZone` 或实例时区（`TZ`，否则系统时区）计算，CLI 新增 `--tz`。会话显示 trace 里记录的会话名（`bySession[].displayName`、CLI `display_name`）。`zhin trace` 的模型列不再显示 `services:<uuid>/`。
