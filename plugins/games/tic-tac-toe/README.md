# @zhin.js/plugin-tic-tac-toe

跨平台井字棋插件，基于 Zhin.js **interactive 消息段**（按钮）与文本降级（1–9 落子）。

## 安装

```yaml
plugins:
  - "@zhin.js/plugin-tic-tac-toe"
database:
  dialect: sqlite
  storage: ./data/zhin.db
```

## 命令

| 命令 | 说明 |
|------|------|
| `ttt` | 帮助与频道状态 |
| `ttt join` | 群聊排队，满 2 人开局 |
| `ttt leave` | 离开排队 |
| `ttt bot` | 人机对战 |
| `ttt quit` | 认输 |
| `ttt spectate` | 观战订阅 |

## 交互

- **Native 按钮**：Sandbox、Telegram、Discord、KOOK、Lark、QQ 系等（见 `interactivePolicy: native`）
- **文本降级**：回复 `1`–`9` 落子（与按钮 `fallback.map` 一致）

## 开发

```bash
pnpm --filter @zhin.js/plugin-tic-tac-toe build
pnpm vitest run plugins/games/tic-tac-toe/tests
```
