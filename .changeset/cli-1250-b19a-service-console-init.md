---
"@zhin.js/cli": minor
---

#1250 第 19a 批（ADR 0062 §1 / §2）：

- `zhin service install` 按当前系统现场生成服务文件，不再依赖脚手架生成的模板：写入当前 `node` 与项目内 `@zhin.js/cli` 的绝对路径（nvm / fnm / volta 安装的 Node 也能开机启动，不再经过 `npx`），只在异常退出时重启（systemd `Restart=on-failure`，launchd `KeepAlive.SuccessfulExit=false`），macOS 改用 `launchctl bootstrap` / `bootout`；Windows 生成计划任务 XML 并给出 NSSM 命令。新增 `zhin service start` / `stop` / `restart`。
- `zhin stop` 遇到由服务托管的前台网关时：旧版服务文件（退出后总是重启）拒绝执行并提示 `zhin service stop`；新版服务文件正常停止并说明何时会再启动。
- 后台 `zhin start`、`zhin status` 与 `zhin restart --gateway` 在 Console 未初始化时（仅交互终端）直接打印带 `#token=` 的初始化链接。
- `zhin console init --status` 默认输出中文说明，JSON 改为 `--status --json`；选择与当前一致的数据库时提示「未改动配置，无需重启」。
