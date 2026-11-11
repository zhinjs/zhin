---
"@zhin.js/cli": minor
"@zhin.js/runtime": patch
"@zhin.js/console-protocol": patch
---

Console 终端（ADR 0051）：Host 配置新增顶层 `console.terminal`（`enabled`、`shell`、`cwd`、`idleTimeout`、`maxSessions`、白名单 `ssh` 目标），开启后 Console 可打开宿主 Shell（`node-pty`）或 SSH 会话（`ssh2`），两者都是 CLI 的可选依赖。只有持有 `ops.terminal` 的所有者能用，初始化令牌不可用；票据一次性、30 秒有效；会话开始与结束写入审计日志；改密码、禁用或删除用户、变更其角色绑定时立即结束该用户的终端会话。默认关闭，关闭时不注册任何路由，也不加载可选模块。`console.terminal` 列入自我变更禁改名单。
