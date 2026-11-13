---
"@zhin.js/host-http": patch
"@zhin.js/core": patch
"zhin.js": patch
---

登录辅助加固（ADR 0058 复审）：登录 RPC 与权限表读同一组 `adapter` / `endpointKey` 字段（`data` 与顶层不一致即拒绝），只凭适配器 / 账号范围授权的调用方，`login.list`、`login.flow.list` / `get`、`login.submit` / `cancel`、`login.relogin` / `refresh` 都限定在被授权的账号，不能再借 `data` 里的目标读取或应答其他账号的挑战；终端只把敏感块和验证链接写到不被采集的终端（TTY stderr 或 `/dev/tty`），`zhin start --foreground` 管道输出里不再出现，没有控制终端时提示改在 Console 查看；兼容事件 `endpoint.login.pending` / `expired` 去掉二维码图片（`imageOmitted: true`）；超过约 24.8 天的挑战截止时间不再立即过期；终端绑定在流程结束后释放其记录。
