---
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-guess-number": patch
---

游戏迁移到 Plugin Runtime（第二批：blackjack / dice-duel / guess-number）：

延续 rps 样板，游戏逻辑不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型，消息类型改用 game-kit 的 `GameMessageLike`；移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互死分支（Runtime 下从不执行），命令与 choice 中间件返回文本视图。保留 core 的数据库/内容活 API（`Database`/`Models`/`RelatedModel`/`SendContent`）。

行为等价（移除的是 Runtime 下恒 null 的死分支）；三个游戏均构建通过、测试全绿（blackjack 16/16、dice-duel 8/8、guess-number 8/8）。
