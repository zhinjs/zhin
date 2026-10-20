# @zhin.js/plugin-idiom-chain

成语接龙插件：支持同音 / 同字接龙，内置词库。

## 安装

```yaml
plugins:
  - "@zhin.js/plugin-idiom-chain"
database:
  dialect: sqlite
  storage: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/接龙` | 帮助与频道状态 |
| `/接龙 start_pinyin` | 同音接龙 |
| `/接龙 start_char` | 同字接龙 |
| `/chain` | 英文别名 |

也可通过 `/游戏` 大厅按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-idiom-chain build
pnpm vitest run plugins/games/idiom-chain/tests
```
