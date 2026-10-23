---
"@zhin.js/cli": patch
---

修复 Agent 持久化在 `activateNext` 里调用已 seal 的 `DisposeStack.add` 导致启动立即退出（`DisposeStack is sealed`）。清理回调改在 setup 阶段注册，激活阶段只做数据库与 admission 接线。
