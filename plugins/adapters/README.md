# 平台适配器

本目录共 **20** 个 `@zhin.js/adapter-*` 包。对外 **Platform Stable** 列表以 [能力分档 — Platform Stable](../../docs/essentials/capability-tiers.md#platform-stable-适配器当前) 为准；其余为 **Advanced** 或 **Experimental**。

| 适配器 | npm 包 | 档位 | 说明 |
|--------|--------|------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | **Stable（Core）** | 本地 Web 控制台调试；[minimal-bot](../../examples/minimal-bot/) 默认 |
| ICQQ | `@zhin.js/adapter-icqq` | **Platform Stable** | `@icqqjs/cli` 守护进程 IPC；先 `icqq login`，配置仅 QQ 号 |
| QQ 官方 | `@zhin.js/adapter-qq` | **Platform Stable** | 官方 Endpoint API |
| NapCat | `@zhin.js/adapter-napcat` | **Platform Stable** | NapCat 桥接 |
| OneBot v11 | `@zhin.js/adapter-onebot11` | **Platform Stable** | OneBot 11 |
| OneBot v12 | `@zhin.js/adapter-onebot12` | Experimental | OneBot 12 |
| Milky | `@zhin.js/adapter-milky` | Experimental | Milky 协议 |
| KOOK | `@zhin.js/adapter-kook` | **Platform Stable** | 开黑啦 |
| Discord | `@zhin.js/adapter-discord` | **Platform Stable** | |
| Telegram | `@zhin.js/adapter-telegram` | **Platform Stable** | |
| Slack | `@zhin.js/adapter-slack` | **Platform Stable** | |
| 钉钉 | `@zhin.js/adapter-dingtalk` | **Platform Stable** | |
| 飞书 | `@zhin.js/adapter-lark` | **Platform Stable** | |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | **Platform Stable** | |
| 微信 iLink（ClawBot） | `@zhin.js/adapter-weixin-ilink` | **Platform Stable** | 个人微信长轮询；实机 dogfood 见 issue #486 |
| LINE | `@zhin.js/adapter-line` | **Platform Stable** | LINE Messaging API（Webhook） |
| 企业微信 | `@zhin.js/adapter-wecom` | **Platform Stable** | 企业微信应用机器人 |
| Email | `@zhin.js/adapter-email` | Experimental | 邮件收发 |
| GitHub | `@zhin.js/adapter-github` | Experimental | GitHub 事件 |
| Satori | `@zhin.js/adapter-satori` | Experimental | Satori 通用协议 |

## 档位含义

- **Stable（Core）**：`pnpm check:stable` Core 批、minimal-bot；Sandbox 入站 + 核心 Agent 契约。
- **Platform Stable**：包内 `integration.test.ts`（adapter-harness）；部分纳入 `pnpm check:stable` Platform 批。
- **Advanced**：test-bot 厨房水槽中常用；实机与 LLM 见 [ACCEPTANCE Advanced](../../examples/test-bot/ACCEPTANCE.md)。
- **Experimental**：可用性因平台/部署差异大；无全量 CI 承诺。

各适配器细节见包内 `README.md`（同步至 [zhin.js.org/adapters](https://zhin.js.org/adapters/)，运行 `pnpm sync:adapter-docs` 更新）。

## README 章节模板（Advanced / Experimental）

**Advanced / Experimental** 包内 `README.md` 推荐包含以下章节（字段与 `src/types.ts` 一致）：

| 章节 | 说明 |
|------|------|
| **前置条件** | 平台账号、Token、公网/HTTPS、`host-router` 等依赖 |
| **最小配置** | 可运行的 `zhin.config.yml` 片段 |
| **故障排查** | 连接失败、鉴权、收不到消息等常见问题 |
| **文档链接** | 文末链接至 `https://zhin.js.org/adapters/{slug}` |

Stable（Sandbox）可省略部分章节，但同样应链到对应文档页。
