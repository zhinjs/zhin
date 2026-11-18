---
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
"@zhin.js/agent": patch
---

`zhin packages status` 读取运行中实例的当前 generation，不再一律报「待重启」；trace 的 `tool_result` 记模型实际拿到的大小（#1250 第 39 批）。

- `plugin-status-always-pending-restart`：CLI 不带 `--live` 时只检查本地文件，没有运行中实例的 snapshot，`published` 永远是 `false`、`restartRequired` 永远是 `true`，于是整套服务刚重启完所有插件也显示 `pending-restart`。现在 `zhin packages status` / `verification-plan` / `apply` / `verify` 省略 `--live` 时经本项目网关的本地套接字转给受监管的实例（与 Console 相同的 `plugin:*` RPC），由持有当前 snapshot 的实例计算状态与 generation；`apply` / `verify` 的 `--live` 因此变为可选，没有连上实例时直接拒绝且不执行任何操作。
- 拿不到 snapshot 时（网关未运行、实例没有应答、实例尚未上报 generation），声明且启用的插件 `status` 为新的 `unknown`，`restartRequired: false`，并在新增的可选字段 `statusReason`（`PluginManagementState`，`@zhin.js/host-http`）说明原因（「没有连上运行中的实例……」「实例尚未上报 generation……」，CLI 离线时再附上网关未运行等具体原因），不再说 `pending-restart`。`install` / `declare` / 启用停用与 `apply` 判断「这次改动是否需要重启」时，对 `unknown` 仍按需要启动处理，行为不变。
- `verification-plan-empty-unexplained`（同一原因）：经网关读取时计划来自运行中的实例，输出标明「经本项目网关读取运行中的实例」，给出的 `zhin packages verify` 命令不再需要 `--live`；离线时额外说明没有连上实例的原因。
- `trace-tool-result-size-pre-strip`：trace 中工具调用的 `result_size` 与时间线 `tool_result` 改为模型实际收到的字符数（拆出媒体、省略内嵌二进制、追加提示之后），与工具原始输出大小不同时另记 `raw_result_size`（时间线写成 `… 240 chars (raw 11559 chars)`，`formatTurnTrace` 写成「240 字符（工具原始输出 11559 字符）」）。
