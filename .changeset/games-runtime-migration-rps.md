---
"@zhin.js/game-kit": patch
"@zhin.js/plugin-rps": patch
---

游戏迁移到 Plugin Runtime（首个游戏 rps + game-kit 共享支撑）：

- **game-kit**：`GameMessageLike`（`command-message.ts`）的 `$sender.name` 放宽为可选，使其成为 core `Message` 的结构兼容超集；`channelKey`（`board-sender.ts`）与 `recordGameOutcome`（`game-records.ts`）的消息参数类型改用 `GameMessageLike`。这样共享 helper 同时接受运行时桥接的 `GameMessageLike` 与迁移过渡期仍传入的 legacy core `Message`，让游戏可逐个迁移而不破坏未迁移游戏的类型。
- **rps**：游戏逻辑（`game-flow.ts` / `rps-command.ts` / `session-service.ts`）不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型；消息类型改用 `GameMessageLike`。移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互分支（Runtime 下从不执行），命令与 choice 中间件返回文本视图；`runRpsCommandText` 合并进 `runRpsCommand`。

行为等价（移除的是 Runtime 下恒 null 的死分支）；rps 构建与 10/10 测试通过，未迁移游戏（blackjack）构建仍通过，验证向后兼容。
