---
"@zhin.js/gateway": minor
"zhin.js": minor
---

Console 用量统计 `plugin.root.usage-stats` 补维度字段（#1250 第 58 批，Token 用量页重新设计第 3 步的后端部分）。全部是新增的可选字段，已有字段含义不变，权限仍是 `control:read`，不返回提示词或消息内容。

- 返回顶层新增 `schemaVersion`（当前为 2），Console 可按它降级。
- `byModel[]` 新增 `driverLabel`（服务所用驱动的显示名）与 `profileId` / `profileName`（这一行的调用都落在同一个模型 Profile 上时），两个服务同名时可以区分。
- 新增 `byAgent[]`（主助手 / 子 Agent / 未记录）与 `byPurpose[]`（`chat`、`agent`、`summary`、`ambient`、`perception` 等，带可读 `label`），数据来自每个（子）回合 trace 的 `model_selection`；没有记录模型选择的旧 trace 归入「未记录」（`@unrecorded`）。
- `bySession[]` 新增结构化会话名字段 `scopeKind`（`group` / `private` / `channel` / `schedule` / `internal` / `http` / `a2a` / `mcp`）、`sceneLabel`（不含类型词的群名 / 用户名等）与 `shortKey`（与 `zhin usage report` 同规则的短键），Console 可按界面语言拼名、重名时追加短键；`displayName` 不变。
- `bySession[]` 新增 `endpoint` 与 `accountLabel`（账号现在的名称）；顶层新增 `sessionsTotal` 与 `othersTotals`（前 50 个之外的会话合计）。
- 请求参数新增可选 `compare: 'previous'`：返回 `previous: { since, until, truncated, totals }`，即紧挨在前、等长的上一周期的汇总（不含明细）；上一周期按毫秒长度平移（不按日历），`session` 过滤同样作用于它；当前区间与上一周期各自最多 31 天（总扫描最多 62 天），只算上一周期的 totals，上一周期被截短时标 `truncated: true`。`compare` 写别的值返回 `invalid_input`。
- `@zhin.js/gateway/usage` 新增导出：常量 `USAGE_STATS_SCHEMA_VERSION`、`USAGE_MAIN_AGENT_KEY`、`USAGE_UNRECORDED_KEY`，函数 `usagePurposeLabel()`、`sessionPartsOf()`，类型 `UsageSessionParts`、`UsageAgentRow`、`UsagePurposeRow`、`UsageStatsPreviousWindow`、`UsageResolvedService`、`UsageProfileResolver`、`UsageAccountResolver`；`UsageStatsQuery` 新增可选 `previous`，`UsageStatsOptions` 新增可选 `resolveProfile` / `resolveAccount`，`UsageProviderResolver` 的返回值可带 `driverLabel`，`UsageStats` 新增上述字段。
- `zhin.js` 实例：`createProviderDisplayIndex()` 新增可选参数 `{ driverLabel }`，`ProviderServiceDisplay` 新增可选 `driverId` / `driverLabel`，服务既无名称又无驱动时省略 `label`（不再把 `services:<id>` 当名称，显示名只剩模型名）；`AssistantStatus` 新增 `bindUsageEndpoints()`；`UsageStatsService` 新增可选 `profileResolver` / `accountResolver`；新增 `previousUsageWindow()` 与类型 `UsageEndpointSource`。
