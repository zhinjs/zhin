---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/gateway": patch
"zhin.js": patch
---

Console 未知 RPC 不再当作安全拒绝（zhinjs/zhin#1250）：Host 既没有处理器、也不在权限表里的 RPC 类型回 `404 { code: 'unknown_rpc' }`，不执行、不写审计（按类型去重记 debug 日志）；有处理器却漏登记权限的仍按 `unmapped` 拒绝并审计。网关未知的 `gateway.*` 同样回 `unknown_rpc`。被拒绝的审计条目在 `detail.reason` 写明原因（`not_authenticated` / `setup_required` / `unmapped_permission` / `unmapped_route` / `insufficient_permission` / `scope_denied` / `handler_denied` / `no_plugin_handler`）。新增能力查询 `GET {base}/console/capabilities`（权限 `authenticated`）：返回 `{ version, rpc, features, complete }`，网关把自己处理的 RPC 与实例的合并，实例未运行或较旧时 `complete: false`（较旧实例每个路由表只问一次）。协议导出 `CONSOLE_UNKNOWN_RPC_CODE`、`CONSOLE_DENIAL_REASONS`、`CONSOLE_CAPABILITIES_PATH`、`CONSOLE_FEATURES`、`createConsoleCapabilities` / `parseConsoleCapabilities` / `mergeConsoleCapabilities`；`authorizeConsoleRpc` 新增 `registered` 选项，Host 导出 `RUNTIME_CONSOLE_RPC_TYPES`、`isAuditedRpcDenial`、`unknownRpcLog`。
