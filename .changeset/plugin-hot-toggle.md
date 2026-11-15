---
"@zhin.js/gateway": minor
"@zhin.js/host-http": minor
"@zhin.js/console-protocol": minor
"@zhin.js/runtime": minor
"zhin.js": minor
"@zhin.js/cli": patch
---

普通插件启停热生效，不再重启实例（zhinjs/zhin#1250 `toggle-plugin-restarts-instance`，ADR 0054 修订 2026-11-15）：实例运行时 `zhin enable` / `zhin disable` 与 Console 全局开关先写 `disable_plugins`，再经控制通道 `plugins.apply` 让实例按该修订换代（退役或装配该插件实例的全部能力），实例不重启、适配器不重新登录。插件声明 `package.json#zhin.toggle: "restart"`、含原生模块、实例启动后依赖有变化、实例不支持或热应用失败时，自动回退为停止 → 启动实例（启动失败照旧恢复配置并启动原实例），结果的 `plugin.apply` / `restartReason` / `restartDetail` 与新阶段 `apply-hot` 说明生效方式和原因；Console RPC 的 `restartRequired` 只在实例确实重启时为 true；CLI 输出「已热生效，实例未重启」或重启原因。
