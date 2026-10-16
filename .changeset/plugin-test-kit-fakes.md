---
"@zhin.js/plugin-test-kit": patch
"@zhin.js/service-activity-feedback": patch
---

plugin-test-kit 新增类型化的假运行环境：`createFakePlugin` / `runPluginSetup` 提供真实 Scope 与内存版数据库、定时（可控时钟）、出站记录，`runCommand` / `runMiddleware` / `runHandler` 直接执行约定目录里的定义，`fakeOf` 取代 `as never`。activity-feedback 的测试已迁移。
