# 游戏插件 (Games)

基于 Zhin.js 的交互式游戏插件目录。

| 插件 | 说明 |
|------|------|
| [@zhin.js/game-kit](../../packages/game-kit/) | 通用游戏工具包（交互键盘、版本化会话、事件与游戏大厅） |
| [@zhin.js/plugin-tic-tac-toe](./tic-tac-toe/) | 井字棋（`井字棋` / `ttt`） |
| [@zhin.js/plugin-rps](./rps/) | 猜拳对决（`猜拳` / `rps` · 三局两胜） |
| [@zhin.js/plugin-guess-number](./guess-number/) | 猜数字（`猜数` / `guess` · 1~100） |
| [@zhin.js/plugin-dice-duel](./dice-duel/) | 骰子对决（`骰子` / `dice` · 三局两胜） |
| [@zhin.js/plugin-dungeon-expedition](./dungeon-expedition/) | 地牢远征（`地牢` / `dungeon` · 1-4 人确定性回合冒险） |
| [@zhin.js/plugin-idiom-chain](./idiom-chain/) | 成语接龙（`接龙` / `chain` · 开源词库 + 同音接龙） |
| [@zhin.js/plugin-word-riddle](./word-riddle/) | 猜谜（`猜谜` · 字谜 + 猜成语） |
| [@zhin.js/plugin-text-adventure](./text-adventure/) | 文字冒险（`冒险` / `adv` · 进度与成就） |
| [@zhin.js/plugin-blackjack](./blackjack/) | 21 点（`21点` / `bj` · 对庄 Blackjack） |
| [@zhin.js/plugin-roulette](./roulette/) | 俄罗斯轮盘（`轮盘` / `roulette` · 多人轮流开枪，可按群开启禁言惩罚） |

## 架构

```
plugins/games/
├── dungeon-expedition/ # 大型多人稳定性样本
├── tic-tac-toe/        # 井字棋插件
└── ...                 # 其他独立游戏包
```

通用底座位于 `packages/game-kit/`，提供：

- **网格键盘** - 任意尺寸按钮棋盘（3×3、15×15 等）
- **结构化交互** - 按钮与文本 fallback 共用语义
- **会话生命周期** - 数据库双轨、超时、事件、战绩与 HMR 对称清理
- **大型游戏原语** - 串行动作、乐观 revision、幂等和确定性随机数

## 命令命名约定

所有游戏共用一套约定（#1250 `game-command-names-mixed-language`）：

- **每个子命令都有中英两种写法，两种都能用。** 中文：开始 / 继续 / 退出 / 认输 / 加入 / 离开 / 观战 / 人机 / 帮助；英文：`start` / `continue` / `quit` / `join` / `leave` / `spectate` / `bot` / `help`。各游戏的 action 表（`@zhin.js/game-kit` 的 `normalize*Action`，或游戏自己的表）同时接受两者。
- **帮助和提示里的写法跟命令名同一种语言。** 命令名含汉字（`猜数字`、`井字棋`、`玩石头剪刀布`）就写 `猜数字 开始`；英文命令名（`guess`、`ttt`）就写 `guess start`。`formatGameHelp()` / `gameCommandHint()` 统一处理，自己拼帮助的游戏（地牢、轮盘、冒险、猜谜）按同一规则选词。
- **游戏标题与中文命令名一致**：井字棋的命令是 `井字棋`（旧名 `井字游戏` 仍可用）。
- **`退出` 与 `认输` 不同**：`quit` 只结束对局、不计胜负（帮助写「结束当前对局（不计胜负）」）；对手会记一胜的退出写作 `forfeit`，中文「认输」，帮助写「认输并结束对局」（井字棋、成语接龙）。
- **近似指令提示列出真实子命令**：`[[action]]` 参数用 `suggestions` / `suggestionsI18n` 声明子命令，「你是不是想用」写 `玩石头剪刀布 开始|继续|退出`，而不是 `[action]`。

## 对局中的回复约定

- 游戏消费了一条输入（猜数、出拳、按钮文字、序号）就**结束这条消息的分发**，不再交给 Agent；`replyGameOperation({ input })` 把消息结局记成 `handler_replied` / `game_input`（ADR 0061）。没有对局或输入不属于游戏时才 `next()`。
- 带按钮的卡片由 `buildChoiceKeyboard()` / `buildGridKeyboard()` 统一加一行「回复序号或按钮文字也可以」；数字另有含义的游戏（猜数字）用 `replyHint: 'label'`，只提示按钮文字。
- 序号和按钮文字（忽略 emoji、空白与大小写）都能当输入：`buildChoiceFallbackMap()` + `resolveGameTextPayload()`。
- 适配器能力画像 `segments.interactive: 'text'`（不支持按钮，如 icqq）时，框架把按钮渲染成一行 `1. 要牌  2. 停牌  3. 放弃`（键盘 `fallback.layout: 'inline'`），游戏不需要按平台分支。
- 井字棋按棋盘位置编号：回复 1–9 落在对应格（左上 1，右下 9）。

## 贡献

新游戏请放在 `plugins/games/<name>/`，遵循 [插件开发文档](../../docs/authoring/define-plugin.md)。
