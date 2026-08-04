---
"@zhin.js/command": patch
"@zhin.js/adapter": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-icqq": patch
---

feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。
