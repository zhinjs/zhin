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
"@zhin.js/plugin-game-hub": patch
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
- 合并窗口：`/` 开头（原始消息或被 @ 后的内容）始终不进合并窗口，即使 `ignorePrefixes` 改成了别的（如 `['~']`）、适配器前缀也不是 `/`——`/` 是各平台通用的斜杠命令记号，这样的消息单独成一轮，不与相邻消息拼成一句。只影响合并窗口，不影响 AI 触发判断。
- 游戏进行中发本游戏的命令口令不再被当成作答：猜谜进行中发 `猜谜` / `猜谜语`、接龙进行中发 `接龙` / `成语接龙`（及口令加已知动作）会交给命令（回帮助），不当谜底 / 成语，不扣失误、不判负。判断按该会话真实的指令前缀：配置了 `/` 时 `/猜谜` 是命令、裸 `猜谜` 仍是作答。`@zhin.js/game-kit` 新增 `routesToGameCommand(input, pattern)` 供自由文本作答的中间件使用。
- （不兼容）`@zhin.js/game-kit` 的游戏定义（`RuntimeRegisteredGame` / `defineGame()`）删除 `commandPrefix` 字段：各游戏写死的 `'/21点'` 一类值不再存在，入口只由 `commandPath` 与命令系统决定。原值去掉 `/` 后并入各游戏的 `aliases`（`骰子`、`地牢`、`猜数`、`接龙`、`轮盘`、`猜拳`、`冒险`、`井字棋`、`猜谜`），`排行 骰子`、`游戏大厅 骰子` 照旧能找到游戏。
- 游戏大厅 AI 工具 `game_catalog` 的 `startCommand` 不再是写死 `/` 的 `/猜数 开始`：改用与 `games` 命令同源的命令索引渲染（`GameIndex.formatCommand`），工具调用没有会话前缀，因此不带前缀（如 `猜数字 开始`），工具说明提示模型在配置了指令前缀的会话里加上前缀；拿不到命令索引时退回 `commandPath`（如 `guess 开始`）。`toGameCatalogEntry()` 新增可选第二参数。
- 各游戏 README 的命令示例注明 `/` 只是示例前缀、按适配器 `commandPrefix` 书写，并把已不存在的 `/游戏` 改为 `游戏大厅`；`docs/ai` 注明与 `commandPrefix` 相同的触发前缀（如 `#`）不再生效。
