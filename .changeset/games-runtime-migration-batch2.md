---
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-idiom-chain": patch
---

游戏迁移到 Plugin Runtime（第三批：word-riddle / text-adventure / tic-tac-toe / idiom-chain）：

延续 rps 样板，游戏逻辑（game-flow / *-command / session-service / board-view）不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型，消息类型改用 game-kit 的 `GameMessageLike`；移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互死分支，命令与 choice/text 中间件返回文本视图；`runXxxCommandText` 合并进 `runXxxCommand`；同步更新命令入口、别名/文本中间件与测试的调用签名。保留 core 的数据库/内容活 API（`Database`/`Models`/`RelatedModel`/`SendContent`）。

行为等价（移除的是 Runtime 下恒 null 的死分支）；四个游戏均构建通过、测试全绿（word-riddle 12/12、text-adventure 26/26、tic-tac-toe 28/28、idiom-chain 19/19）。
