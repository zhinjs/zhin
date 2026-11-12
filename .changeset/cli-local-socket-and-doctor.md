---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
"@zhin.js/runtime": patch
---

- 网关运行时，`zhin config`、`zhin schedule`、`zhin send`、`zhin watch` 经本地控制套接字 `.zhin/gateway.sock`（新 RPC `gateway.http.request`）以本机所有者身份访问实例，Console 初始化后不再因 `http.token` 失效而 401；网关未运行时仍走 HTTP，401 时提示签发 API 令牌（`ZHIN_CONSOLE_TOKEN`）。
- `zhin doctor --fix` 生成随机初始化令牌（32 字节），不再写入固定的 `zhin-local-token`；提示改为「初始化令牌只在创建首个所有者前有效」，并检查网关是否运行、Console 是否已初始化。
- `zhin start --help` 的示例与实际行为一致：只有 `-f, --foreground`、`--once`、`--standalone` 在前台运行，生产示例写成 `zhin start --foreground --mode production --no-watch`；`-d, --daemon` 不再重复列出。`zhin status --help` 写明网关未运行时退出码为 3。
- 新增配置 `gateway.readyTimeout`（整数秒，1–3600，默认 60）：实例启动、重启与依赖事务等待就绪的最长时间。
- `zhin start --foreground`（含 `zhin runtime start`）在 stdin 是 TTY 时把终端输入交给实例，终端类适配器可以在网关下读到输入；后台网关仍不给实例 stdin。
- `zhin migrate` 与插件迁移（package cutover / verify）以 `zhin start` 为准：`dev` 写成 `zhin start --foreground --watch source config`，`start` 写成 `zhin start --foreground --mode production --no-watch`，`daemon` 写成 `zhin start --mode production --no-watch`；已有的 `zhin start …` 与别名 `zhin runtime start …` 不再被改写。
