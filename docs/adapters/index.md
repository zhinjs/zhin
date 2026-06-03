# 平台适配器

适配器连接 IM / 聊天平台与 Zhin.js 核心。每个 `@zhin.js/adapter-*` 包有**独立文档页**，内容与包内 `README.md` 保持同步（`pnpm sync:adapter-docs`）。

> 框架级概念（多平台同跑、群管工具自动注册等）见 [适配器概览](/essentials/adapters)。

## 档位

| 档位 | 含义 |
|------|------|
| **Stable** | 与 `pnpm check:stable`、 [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 一致 |
| **Advanced** | [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 厨房水槽常用 |
| **Experimental** | 可用性因部署差异大，需自行验证；**≠ 无测试**，= 无全量 CI/实机承诺 |

## Stable

| 适配器 | 包名 | 文档 |
|--------|------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | [Sandbox](/adapters/sandbox) |

## Advanced

| 适配器 | 包名 | 文档 |
|--------|------|------|
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | [ICQQ](/adapters/icqq) |
| QQ 官方 | `@zhin.js/adapter-qq` | [QQ 官方](/adapters/qq) |
| OneBot v11 | `@zhin.js/adapter-onebot11` | [OneBot v11](/adapters/onebot11) |
| KOOK | `@zhin.js/adapter-kook` | [KOOK](/adapters/kook) |
| Discord | `@zhin.js/adapter-discord` | [Discord](/adapters/discord) |
| Telegram | `@zhin.js/adapter-telegram` | [Telegram](/adapters/telegram) |
| Slack | `@zhin.js/adapter-slack` | [Slack](/adapters/slack) |
| 钉钉 | `@zhin.js/adapter-dingtalk` | [钉钉](/adapters/dingtalk) |
| 飞书 | `@zhin.js/adapter-lark` | [飞书](/adapters/lark) |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | [微信公众号](/adapters/wechat-mp) |

## Experimental

| 适配器 | 包名 | 文档 |
|--------|------|------|
| NapCat | `@zhin.js/adapter-napcat` | [NapCat](/adapters/napcat) |
| OneBot v12 | `@zhin.js/adapter-onebot12` | [OneBot v12](/adapters/onebot12) |
| Milky | `@zhin.js/adapter-milky` | [Milky](/adapters/milky) |
| Satori | `@zhin.js/adapter-satori` | [Satori](/adapters/satori) |
| Email | `@zhin.js/adapter-email` | [Email](/adapters/email) |
| GitHub | `@zhin.js/adapter-github` | [GitHub](/adapters/github) |

## 维护说明

- **单一来源**：`plugins/adapters/<name>/README.md` 为各适配器文档权威来源
- **同步命令**：仓库根目录 `pnpm sync:adapter-docs`
- **CI 检查**：`pnpm check:adapter-docs`（README 变更后须同步）

源码索引：[plugins/adapters/README.md](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/README.md)
