# @zhin.js/plugin-idiom-chain

成语接龙插件：支持同音 / 同字接龙，内置词库。

## 安装

```yaml
configVersion: 2
plugins:
  idiom-chain: "@zhin.js/plugin-idiom-chain"
database:
  dialect: sqlite
  filename: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `/接龙` | 帮助与频道状态 |
| `/接龙 start_pinyin` | 同音接龙 |
| `/接龙 start_char` | 同字接龙 |
| `/chain` | 英文别名 |

> 表中的 `/` 是示例指令前缀：实际按适配器配置的 `commandPrefix` 书写，未配置（默认）时不带，直接发 `接龙 继续`。短口令 `接龙` 只认整句口令或口令加一个已知动作（如 `接龙 继续`），`接龙 今天天气不错` 这类聊天不会开游戏。 对局中发 `接龙`、`成语接龙` 是命令（看帮助），不当成语作答。

也可通过 `/游戏大厅` 按钮进入。

## 开发

```bash
pnpm --filter @zhin.js/plugin-idiom-chain build
pnpm vitest run plugins/games/idiom-chain/tests
```
