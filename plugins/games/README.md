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

## 贡献

新游戏请放在 `plugins/games/<name>/`，遵循 [插件开发文档](../../docs/essentials/plugins.md)。
