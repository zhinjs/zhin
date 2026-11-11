---
"@zhin.js/database": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

网关 SQLite 连接改为异步遇忙重试（不再用同步 busy_timeout 阻塞事件循环），超时返回 `503 database_busy` 与 Retry-After，认证簿记写入遇忙跳过；事务新增 `readOnly` 选项（SQLite 以 `BEGIN DEFERRED` + `query_only` 开启，不拿写锁）。网关运行时 `zhin console init` / `zhin console user` 经本地套接字由网关自身的初始化与账号服务执行（切换数据库由网关重连并重启实例，所有者状态立即生效），`zhin setup --install` 经 `gateway.packages.install` 安装并显示进度；无网关时保持直连。
