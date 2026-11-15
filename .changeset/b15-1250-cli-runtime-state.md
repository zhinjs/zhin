---
"@zhin.js/cli": minor
---

命令行看得到运行状态，升级不留半截（zhinjs/zhin#1250 第 15 批）：

- `zhin status` 经本项目网关的本地套接字读取 `endpoint.list`、MCP 状态与 `attention.list`，逐个显示适配器账号是否在线、MCP 服务状态和「需要你处理」的数量；每次读取都有超时，读不到时显示「无法读取」，不影响退出码。`--json` 新增 `endpoints`、`mcp`、`attention`。
- 运行中的网关版本与已安装的 `@zhin.js/gateway` 不一致时，`zhin status` / `zhin doctor` 给出确切的重启命令：后台网关 `zhin restart --gateway`，systemd `systemctl [--user] restart <unit>`，launchd `launchctl kickstart -k gui/<uid>/<label>`，PM2 `pm2 restart <name>`；`zhin update` 结束时如果网关包有变化也会提示。`zhin restart --gateway` 能识别由 launchd 托管的前台网关。
- `zhin doctor` 在网关运行时把「需要你处理」的每一项和读不到的来源列为警告；网关未运行时读取 `.zhin/runtime-failures.json`（由实例 zhin.js 记录各模型账号、适配器账号与 MCP 服务的最近一次失败），显示为「上次运行」；文件不存在时不显示、不报错。有警告时不再显示「所有检查通过」；`--fix` 没有可自动修复的项时会明确说明，并列出每项的手动修复方法。TypeScript 检查改为读取项目自己安装的版本和 package.json 声明的范围，不再看 PATH 上的全局 `tsc`。
- 「Zhin 包单实例」检查列出每个副本由谁依赖（例如 `zhin.js ×2：1.4.0 ← 根项目；1.2.0 ← plugins/foo ("~1.2.0")`），并给出具体修复（改哪个 package.json，或运行 `zhin migrate`）。
- `zhin migrate` 按 `pnpm-workspace.yaml` 的 `packages` 一并升级工作区里每个包的 zhin 依赖（精确版本同样升级、保持精确；`workspace:` / `link:` / `file:` 跳过），并同步 `pnpm-workspace.yaml` 的 `overrides:`。
- 未知子命令加 `--help` 时也报错并以非 0 退出，附最接近的命令；`zhin plugin list` 提示 `zhin plugin` 是插件作者工具，查看已安装插件用 `zhin packages list`。
- `zhin chat-roles export|import` 新增 `--host` / `--allow-unverified-host`，与 send / schedule 一致。
- `*.localhost` 不再视为可以明文发送 Console 令牌的回环地址（Node 经系统解析器解析它）；核对项目标识时仍算本机。显式 `--host` 的主机名会先做一次带超时的 DNS 解析，解析到本机时同样核对项目标识（解析结果从不用来放行明文令牌）。
