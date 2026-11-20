---
"@zhin.js/agent": minor
"@zhin.js/game-kit": minor
"@zhin.js/core": patch
"@zhin.js/runtime": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
---

「这条消息是不是命令」只有一套判断，游戏短口令改走命令系统（#1250 第 82 批）。

- AI 入口（触发匹配、插话判断、直播间、群聊合并窗口）判断「命令样消息」统一为：该消息所在适配器 / 账号的真实 `commandPrefix`（非空时）加上 `ai.trigger.ignorePrefixes`（默认 `/`、`!`、`！`）。`commandPrefix` 为 `''` 时不加入，不会把所有消息都当命令；配置了 `ignorePrefixes` 时替换默认三项，但真实前缀始终算命令。消息只有在没有命令认领后才会进入 Agent，这里只决定「未被认领的命令样消息」不当 AI 消息、不进合并窗口。
- 合并窗口去掉写死的 `/^[/#]/`：被 @ 后的内容（`@bot /status`）也走同一判断；`#` 只有是该适配器的命令前缀时才算命令（原始消息以 `#` 触发前缀开头时照旧不进窗口）。
- 行为变化：适配器 `commandPrefix` 为 `#` 等时，以该前缀开头而没有命令认领的消息不再被 `#` 触发前缀交给 AI。
- `@zhin.js/agent/runtime` 的 `hasIgnoredTriggerPrefix(text, trigger, commandPrefix)` 新增必填参数 `commandPrefix`（不兼容）。
- 游戏短口令（`21点 开始`、`接龙 继续`、`猜拳 石头`、`轮盘 加入`……）不再由各游戏的 `middlewares/*-alias` 入站中间件接管，改为命令自身的 `match`（`gameCommandMatch()`：整句正好是口令，或口令加一个该游戏认识的动作词）。删除 `@zhin.js/game-kit` 的 `defineGameCommandAliasMiddleware()` 与类型 `GameCommandAliasRoute`，以及 10 个游戏的 `middlewares/*-alias`，不留兼容。
- 行为变化（更一致）：短口令现在照常经过指令前缀、permit、冷却与结局记录；不再无条件剥掉开头的 `/`——适配器配置了 `commandPrefix` 时要带该前缀，未配置时 `/21点` 不再是命令。
- 新增 `二十一点` 短口令；`二十一点 开会`、`21点 开会`、`接龙 今天天气不错` 这类聊天不是命令（旧中间件对 `21点 <任意词>` 会接管）。21 点新增动作 `要牌` / `停牌`（`hit` / `stand`）。
- `@zhin.js/game-kit`：新增 `gameCommandMatch()`、`gameCommandAction()`、`normalizeBjAction()`、`gameActionWords()` 与类型 `GameActionTableId`；删除 `isTttAction()`、`isAdvAction()`、`isRpsAction()`、`isGuessAction()`、`isDiceAction()`、`isChainAction()`、`isRiddleAction()`（只供已删除的别名中间件使用）。21 点不再各写两份动作归一化，统一用动作表。
