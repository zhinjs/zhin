---
"@zhin.js/plugin-runtime": patch
"@zhin.js/console-protocol": patch
"@zhin.js/pagemanager": patch
"@zhin.js/client": patch
"@zhin.js/cli": patch
---

Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.
