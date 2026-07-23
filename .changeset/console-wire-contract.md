---
"@zhin.js/console-protocol": minor
"@zhin.js/client": minor
"@zhin.js/adapter": minor
"@zhin.js/core": minor
"@zhin.js/host-http": patch
"@zhin.js/host-api": patch
"@zhin.js/cli": patch
---

深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。
