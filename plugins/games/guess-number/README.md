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

也可通过 `/游戏` 大厅按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-guess-number build
pnpm vitest run plugins/games/guess-number/tests
```
