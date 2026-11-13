---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

新增 `zhin enable <plugin>` / `zhin disable <plugin>`：把已安装并已声明的插件实例移出或加入 `disable_plugins`（实例键，或只声明一次的包名）。网关运行时经新的 `gateway.plugins.enable` / `gateway.plugins.disable`（`plugin.manage`）执行只写配置的事务：停实例、写配置、启实例，启动失败时恢复配置并启动旧实例；网关未运行时直接写配置，下次 `zhin start` 生效。已是目标状态时成功且不改动；未声明、保留键、项目根插件，以及启用时包未安装、依赖无法解析或配置不通过插件 Schema 时报错（退出码 1）。`PluginManagementWorkflow` 新增 `planSetEnabled` / `setEnabled`；事务结果新增 `plugin` 字段，包来源新增 `local`（本地插件只限所有者启停）。
