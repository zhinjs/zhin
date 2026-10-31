---
"@zhin.js/cli": patch
---

修复 Console Host 页面路由（如 `/sandbox`）返回 503：`topology.resolve()` 现在在 `runView` 视图租约内调用。
Fix Console Host page routes (e.g. `/sandbox`) returning 503 by resolving the route inside the `runView` lease.
