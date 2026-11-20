# @zhin.js/plugin-guess-number

猜数字小游戏：在 1~100 范围内七步内猜中神秘数。

## 安装

```yaml
configVersion: 2
plugins:
  guess-number: "@zhin.js/plugin-guess-number"
database:
  dialect: sqlite
  filename: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/猜数` | 帮助与频道状态 |
| `/猜数 开始` | 开始新局 |
| `/猜数字`、`/guess` | 同一指令的中文名与英文名（菜单中文环境显示 `猜数字`） |

> 表中的 `/` 是示例指令前缀：实际按适配器配置的 `commandPrefix` 书写，未配置（默认）时不带，直接发 `猜数 开始`。短口令 `猜数` 只认整句口令或口令加一个已知动作（如 `猜数 开始`），`猜数 好难` 这类聊天不会开游戏。

也可通过 `/游戏大厅` 按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-guess-number build
pnpm vitest run plugins/games/guess-number/tests
```
