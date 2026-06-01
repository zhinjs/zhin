# 平台适配器

本目录共 **17** 个 `@zhin.js/adapter-*` 包。对外承诺以 **Stable** 列为准；其余为 **Advanced** 或 **Experimental**（需自行验证）。

| 适配器 | npm 包 | 档位 | 说明 |
|--------|--------|------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | **Stable** | 本地 Web 控制台调试；[minimal-bot](../../examples/minimal-bot/) 默认 |
| ICQQ | `@zhin.js/adapter-icqq` | Advanced | QQ 协议（icqq）；维护者全配置见 test-bot |
| QQ 官方 | `@zhin.js/adapter-qq` | Advanced | 官方 Bot API |
| NapCat | `@zhin.js/adapter-napcat` | Experimental | NapCat 桥接 |
| OneBot v11 | `@zhin.js/adapter-onebot11` | Advanced | OneBot 11 |
| OneBot v12 | `@zhin.js/adapter-onebot12` | Experimental | OneBot 12 |
| Milky | `@zhin.js/adapter-milky` | Experimental | Milky 协议 |
| KOOK | `@zhin.js/adapter-kook` | Advanced | 开黑啦 |
| Discord | `@zhin.js/adapter-discord` | Advanced | |
| Telegram | `@zhin.js/adapter-telegram` | Advanced | |
| Slack | `@zhin.js/adapter-slack` | Advanced | |
| 钉钉 | `@zhin.js/adapter-dingtalk` | Advanced | |
| 飞书 | `@zhin.js/adapter-lark` | Advanced | |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | Advanced | |
| Email | `@zhin.js/adapter-email` | Experimental | 邮件收发 |
| GitHub | `@zhin.js/adapter-github` | Experimental | GitHub 事件 |
| Satori | `@zhin.js/adapter-satori` | Experimental | Satori 通用协议 |

## 档位含义

- **Stable**：与 `pnpm check:stable`、minimal-bot 一致；Sandbox 入站 + 核心 Agent 契约。
- **Advanced**：test-bot 厨房水槽中常用；实机与 LLM 见 [ACCEPTANCE Advanced](../../examples/test-bot/ACCEPTANCE.md)。
- **Experimental**：可用性因平台/部署差异大；无 CI 全量承诺。

各适配器细节见包内 `README.md`。
