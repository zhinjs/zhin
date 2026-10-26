---
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
---

Console 令牌新增 `scope: user`（与 `demo` 等价，表示普通用户）。普通用户现在可以执行插件 Console 动作，前提是动作自己声明了 `requiredPermissions` 或 `requiredRoles`，并且令牌全部满足；没有声明要求的动作仍然只给管理员。用户仍然就是 `zhin.config.yml` 里的 `http.tokens` 条目。
