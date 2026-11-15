---
"@zhin.js/command": patch
"@zhin.js/console-protocol": patch
"zhin.js": patch
---

两个插件的命令或别名重名不再让实例启动失败（#1250 duplicate-command-route-crashes-instance）。以前 Command 索引遇到重名路由直接抛 `Duplicate Command route`，实例退出、被网关反复拉起，所有适配器下线。现在：

- 命令名称冲突时，先注册的保留（按插件在配置里的声明顺序，同一插件内按命令路径），后来的那条命令连同它的别名、快捷方式不注册；
- 只有别名或快捷方式冲突时，只跳过这个别名或快捷方式，命令本身照常注册；命令名称优先于别的命令的别名；
- 插件热重载替换自己的命令不算冲突，热重载也不会改变由谁保留路由。

每处冲突在启动（及热重载）日志里打一条 warn（`op=command_route_conflict`），并作为 `command.conflict` 列在 Console「需要你处理」和 `zhin doctor` 的运行状态里，写明两个插件名、命令名或别名，以及建议：让其中一个插件改名（或配置 `commandNamespace`），或在配置里用 `disabledCommands` 禁用其一。`CommandIndex` 新增 `conflicts()`；`@zhin.js/console-protocol` 的 attention 新增 `command.conflict`（需要 `feature.view`）与 `subject.commandRoute`。
