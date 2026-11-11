---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
---

依赖事务与网关 RPC（ADR 0054 §4 / §5，B1.5）

- gateway：`GatewayPackageService`——`gateway.packages.list | plan | install | uninstall | update` 复用插件管理事务：停实例 → 执行包管理器 → 起实例并等待稳定 → 失败时恢复 `package.json` / 锁文件 / 配置、重新安装、启动旧版本，并报告失败阶段与日志尾部；进度可订阅（`subscribe()`）；`dispatchGatewayRpc` 统一检查权限并分发 `gateway.packages.*` 与 `gateway.instance.*`；Windows 下包管理器经 `.cmd` 解析启动。
- console-protocol：新增 `gateway.*` RPC 契约（请求 / 结果类型、`GATEWAY_RPC_PERMISSIONS`、`gateway.packages.progress`），并并入 `CONSOLE_RPC_PERMISSIONS`。
