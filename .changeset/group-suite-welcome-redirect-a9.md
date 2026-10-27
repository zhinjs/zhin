---
"@zhin.js/plugin-group-suite": patch
"@zhin.js/core": patch
"@zhin.js/cli": patch
---

群欢迎 A9 方案②（#1012）：新增 `memberWelcomeOwnerToken`，Agent host 在根作用域提供。group-suite 欢迎发送前询问归属；会话开启 session-ops `welcome.enabled` 时让路不发，由 MemberLifecycle 发唯一一条，两边同时开启不再双发。未装 Agent 或会话未开启时行为不变。
