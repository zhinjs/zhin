---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

安装缺少必填配置的插件（如需要账号的适配器）时只安装依赖、不声明，结果报告 `needsConfiguration`（缺少的字段与环境变量），事务不再回滚；新增 `gateway.plugins.declare`（`plugin.manage`，按插件 Schema 校验、原子写入声明与配置、重启实例、失败回滚配置）。回滚日志尾部只含本次事务期间的实例输出。`zhin install` / `zhin setup` 对需要先配置的插件给出提示；经网关安装时显示网关阶段输出，不再打印本地 pnpm 命令行。
