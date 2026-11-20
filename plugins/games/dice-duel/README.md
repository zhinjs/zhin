# @zhin.js/plugin-dice-duel

骰子对决插件：双方掷骰比大小，三局两胜。

## 安装

```yaml
configVersion: 2
plugins:
  dice-duel: "@zhin.js/plugin-dice-duel"
database:
  dialect: sqlite
  filename: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/骰子` | 帮助与频道状态 |
| `/骰子 开始` | 开始对局 |
| `/骰子 继续` | 继续当前局 |
| `/dice` | 英文别名 |

> 表中的 `/` 是示例指令前缀：实际按适配器配置的 `commandPrefix` 书写，未配置（默认）时不带，直接发 `骰子 开始`。短口令 `骰子` 只认整句口令或口令加一个已知动作（如 `骰子 开始`），`骰子 是谁的` 这类聊天不会开游戏。

也可通过 `/游戏大厅` 按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-dice-duel build
pnpm vitest run plugins/games/dice-duel/tests
```
