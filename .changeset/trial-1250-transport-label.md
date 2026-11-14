---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"zhin.js": patch
---

Endpoint 的传输状态有了可读文字（#1250）：`endpoint.list` / `endpoint.info` 的每行在原始 `transportState` 旁新增 `transportLabel`（如 `open` → `已连接`、`reconnecting` → `重连中`）；「需要你处理」中离线账号的说明改用这段文字（不再显示「连接状态：closed」）。`@zhin.js/console-protocol` 新增 `ConsoleEndpointTransportState` 类型与 `endpointTransportLabel(state, locale)`，`ConsoleEndpointSummary` 新增可选字段 `transportLabel`。
