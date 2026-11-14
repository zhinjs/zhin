---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
---

CLI 不再落到别的项目的网关上（#1250，安全）：

- `zhin config get/set/unset/list`、`zhin send`、`zhin schedule …`、`zhin watch` 在本项目网关未运行时直接报「本项目的网关未运行（zhin start 启动；`zhin config` 还可加 `--offline`）」，不再按配置的 `http.port` 去请求 `127.0.0.1` 并带上 `ZHIN_CONSOLE_TOKEN` / `HTTP_TOKEN`——那个端口上可能是另一个正在运行的项目，原先可能改到它的配置。`zhin console init` 判断「Host 是否运行」也只看本项目网关。
- 确需连接其他地址时显式 `--host <url>`（`zhin send`、`zhin schedule`、`zhin watch` 新增该选项；`zhin config --host`、`zhin packages … --live` 原有）。本机地址会先读对方 `GET /pub/health` 的新字段 `project.id`（`GatewayHealth.project`，项目根路径的哈希，`@zhin.js/gateway/project` 的 `projectIdentity()`），与当前项目不一致就拒绝，不发送请求和令牌；没有报告项目标识的旧版网关或 `--standalone` 实例默认同样拒绝（只发出 `/pub/health` 探测，不发送令牌，非零退出），提示升级并用 `zhin start` 启动；确认目标无误时可加新选项 `--allow-unverified-host`（`zhin config`、`zhin send`、`zhin schedule`、`zhin watch`、`zhin packages … --live` 均支持）改为警告后继续。非本机地址仍不核对。
