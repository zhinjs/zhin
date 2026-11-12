---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/client": patch
"@zhin.js/gateway": patch
"zhin.js": patch
---

插件的安装、更新、卸载只走网关依赖事务 `gateway.packages.install | update | uninstall`（先停实例、失败回滚、需要配置的插件只装不声明）。删除实例内直接运行包管理器的 `plugin:install` / `plugin:update` / `plugin:uninstall` RPC 及其权限登记（`PLUGIN_RPC.INSTALL|UPDATE|UNINSTALL` 不再导出），实例只保留只读的 `plugin:plan-*`。`@zhin.js/client` 的 `installPlugin(packages, request?, options?)` / `updatePlugin(name, version, request?, options?)` / `uninstallPlugin(packages, request?, options?)` 改为调用网关 RPC，返回 `GatewayPackageTransactionResult`（`ok`、`status`、`needsConfiguration`、`errors`、`missingEnv`、`logTail`），不再接受 `expectedRevision`；新增 `planPackages()`（`gateway.packages.plan`），包事务默认超时改为 300 秒。

网关转发失败的响应统一为 `GatewayInstanceErrorReply`：`503 instance_unavailable`（带 `Retry-After`）、`504 instance_timeout`、`502 instance_error`，都带 `requestOutcome`（`not-dispatched` / `unknown`）与实例 `state`；`GET /pub/health`（`GatewayHealth`）不缓存，可供 Console 在实例离线时轮询。
