---
"@zhin.js/cli": patch
---

`zhin restart --gateway` 遇到前台网关（`zhin start --foreground`）时给出明确说明与替代命令并以退出码 1 结束：在 Linux 上从网关进程的环境变量识别 systemd（`INVOCATION_ID`，单元名取自 cgroup）与 PM2（`pm_id`），分别提示 `systemctl restart <单元>` / `pm2 restart <应用名>`，否则提示经服务管理器重启或按 Ctrl+C 后用原启动参数重新执行 `zhin start --foreground`（#1250）。
