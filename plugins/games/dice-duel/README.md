# @zhin.js/plugin-dice-duel

骰子对决插件：双方掷骰比大小，三局两胜。

## 安装

```yaml
plugins:
  - "@zhin.js/plugin-dice-duel"
database:
  dialect: sqlite
  storage: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/骰子` | 帮助与频道状态 |
| `/骰子 开始` | 开始对局 |
| `/骰子 继续` | 继续当前局 |
| `/dice` | 英文别名 |

也可通过 `/游戏` 大厅按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-dice-duel build
pnpm vitest run plugins/games/dice-duel/tests
```
