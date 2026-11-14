# @zhin.js/plugin-rps

石头剪刀布猜拳插件，三局两胜；支持游戏大厅按钮与文本命令。

## 安装

```yaml
configVersion: 2
plugins:
  rps: "@zhin.js/plugin-rps"
database:
  dialect: sqlite
  filename: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/猜拳` | 帮助与频道状态 |
| `/猜拳 开始` | 开始对局 |
| `/猜拳 继续` | 继续当前局 |
| `/rps` | 英文别名 |

也可通过 `/游戏大厅` 按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-rps build
pnpm vitest run plugins/games/rps/tests
```
