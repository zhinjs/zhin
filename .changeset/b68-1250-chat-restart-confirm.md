---
"zhin.js": patch
---

聊天重启命令 `restart`（别名 `重启`、`reboot`）更安全（zhinjs/zhin#1250 第 68 批）：仍只给全局层 `owner`（私聊与群聊均可，其他人得到原有的无权限回复），现在需要二次确认——第一次发送只回复确认提示，60 秒内由同一个人在同一个会话发送 `restart confirm`（或 `重启 确认`）才执行，过期、换人或换会话都无效。确认后仍先回复「正在重启」，再经与 Console 重启相同的网关路径重启实例；不受网关监管时说明原因且不做任何事。每次请求、拒绝与确认记入 Console 审计（`instance.chat:restart`，只记身份与会话标识），确认触发时写一条 `instance_restart_requested` 日志。不新增公共导出。
