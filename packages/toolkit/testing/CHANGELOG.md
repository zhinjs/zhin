# @zhin.js/plugin-test-kit

## 1.0.3

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45
  - @zhin.js/runtime@1.1.8

## 1.0.2

### Patch Changes

- b947298: testing 新增类型化的假运行环境：`createFakePlugin` / `runPluginSetup` 提供真实 Scope 与内存版数据库、定时（可控时钟）、出站记录，`runCommand` / `runMiddleware` / `runHandler` 直接执行约定目录里的定义，`fakeOf` 取代 `as never`。activity-feedback 的测试已迁移。

  包名由 `@zhin.js/plugin-test-kit` 改为 `@zhin.js/testing`（目录 `packages/toolkit/testing`）。旧名 `@zhin.js/plugin-test-kit` 不再更新，请改用新包；API 与 `PluginTestKit` 类名不变。

- Updated dependencies [a64716a]
- Updated dependencies [0c35b96]
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/runtime@1.1.7
  - @zhin.js/adapter@1.1.19
  - @zhin.js/command@1.1.7
  - @zhin.js/core@1.1.44
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/handler@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/middleware@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.0.1

### Patch Changes

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [7d2263c]
- Updated dependencies [7d2263c]
- Updated dependencies [a62acca]
- Updated dependencies [386150d]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/core@1.1.43
  - @zhin.js/runtime@1.1.6
  - @zhin.js/plugin-runtime@1.1.13
