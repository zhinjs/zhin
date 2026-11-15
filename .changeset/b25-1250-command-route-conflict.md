---
"@zhin.js/command": patch
"@zhin.js/console-protocol": patch
"zhin.js": patch
---

不同插件的命令或别名重名不再让实例启动失败（#1250 duplicate-command-route-crashes-instance）。以前 Command 索引遇到重名路由直接抛 `Duplicate Command route`，实例退出、被网关反复拉起，所有适配器下线。现在：

- 命令名称冲突时，先声明的插件保留（按插件在配置里的声明顺序），后来的那条命令连同它的别名、快捷方式不注册，它的子命令仍然可用；
- 只有别名或快捷方式冲突时，只跳过这个别名或快捷方式，命令本身照常注册；命令名称优先于别的插件的别名；
- 同一插件内部的冲突仍然在加载时报 `Duplicate Command route`，插件自己的测试能发现；
- 插件热重载替换自己的命令不算冲突，热重载也不会改变由谁保留路由；
- 插件按适配器、账号或会话关闭时，在保留方被关闭的端点上，原来被跳过的命令会生效。

**升级注意**：后声明的插件如果有与前一个插件的别名同名的命令（例如 A 的 `admin` 带别名 `ban`，B 有命令 `ban`），升级后 `ban` 由 B 处理，而不是像以前那样启动失败。用户熟悉的指令换了处理方，所以这种冲突在「需要你处理」里标为严重（`danger`），升级后请检查并处理。

每处冲突在启动（及热重载）日志里打一条 warn（`op=command_route_conflict`），并作为 `command.conflict` 列在 Console「需要你处理」和 `zhin doctor` 的运行状态里，写明两个插件名、命令名或别名，以及建议：让其中一个插件改名（或配置 `commandNamespace`），或在配置里用 `disabledCommands` 禁用其一。`CommandIndex` 新增 `conflicts()`；`@zhin.js/console-protocol` 的 attention 新增 `command.conflict`（需要 `feature.view`）与 `subject.commandRoute` / `command` / `commandKind`。
