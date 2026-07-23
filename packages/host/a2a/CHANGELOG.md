# @zhin.js/a2a

## 2.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/host-router@3.0.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0

## 1.0.3

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/agent@1.0.4
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/host-router@2.0.4

## 1.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/core@1.3.4
  - @zhin.js/host-router@2.0.3
  - @zhin.js/logger@1.0.74
  - zhin.js@4.1.2

## 1.0.1

### Patch Changes

- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/agent@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 1.0.0

### Major Changes

- Initial A2A v1.0 server plugin (`@a2a-js/sdk@1.0.0-beta.0`)
- Multi Agent Card per `ai.agents[]`
- Replaces MCP Agent Mesh v1 inbound delegation
