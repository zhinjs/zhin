# 游戏插件 (Games)

基于 Zhin.js 的交互式游戏插件目录。

| 插件 | 说明 |
|------|------|
| [@zhin.js/game-shared](./shared/) | 通用游戏工具包（网格键盘、选项键盘、会话、`game` 服务 / 游戏大厅） |
| [@zhin.js/plugin-tic-tac-toe](./tic-tac-toe/) | 井字棋（`井字棋` / `ttt`） |
| [@zhin.js/plugin-rps](./rps/) | 猜拳对决（`猜拳` / `rps` · 三局两胜） |
| [@zhin.js/plugin-guess-number](./guess-number/) | 猜数字（`猜数` / `guess` · 1~100） |
| [@zhin.js/plugin-dice-duel](./dice-duel/) | 骰子对决（`骰子` / `dice` · 三局两胜） |
| [@zhin.js/plugin-idiom-chain](./idiom-chain/) | 成语接龙（`接龙` / `chain` · 开源词库 + 同音接龙） |
| [@zhin.js/plugin-word-riddle](./word-riddle/) | 猜谜（`猜谜` · 字谜 + 猜成语） |
| [@zhin.js/plugin-text-adventure](./text-adventure/) | 文字冒险（`冒险` / `adv` · 进度与成就） |
| [@zhin.js/plugin-blackjack](./blackjack/) | 21 点（`21点` / `bj` · 对庄 Blackjack） |

## 架构

```
plugins/games/
├── shared/           # 通用工具包
│   ├── grid-keyboard.ts   # 网格按钮键盘构建器
│   ├── board-sender.ts    # 跨平台发送/编辑
│   └── game-session.ts    # 会话接口
└── tic-tac-toe/      # 井字棋插件
    └── ...
```

新游戏开发推荐使用 `@zhin.js/game-shared` 工具包，提供：

- **网格键盘** - 任意尺寸按钮棋盘（3×3、15×15 等）
- **发送策略** - 自动处理平台差异（QQ 新发、其他编辑）
- **会话接口** - 回合制游戏通用结构

## 贡献

新游戏请放在 `plugins/games/<name>/`，遵循 [插件开发文档](../../docs/essentials/plugins.md)。
