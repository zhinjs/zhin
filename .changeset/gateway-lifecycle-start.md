---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

- gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
- console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
- cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
- zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
- runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。
