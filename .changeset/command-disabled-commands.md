---
"@zhin.js/command": patch
"@zhin.js/runtime": patch
---

Plugin instances accept a framework-owned `disabledCommands` list (like `commandNamespace`). Listed commands, given by their local path without namespace or parameters (`fanyi`, `netease login`; a parent path covers its subcommands), are left out of routing, so an application can drop the few commands that overlap with another plugin instead of prefixing every command of the plugin.
