# 平台适配器

适配器连接 IM / 聊天平台与 Zhin.js 核心。每个 `@zhin.js/adapter-*` 包有**独立文档页**，内容与包内 `README.md` 保持同步（`pnpm sync:adapter-docs`）。

> 框架级概念（多平台同跑、群管工具自动注册等）见 [适配器概览](/essentials/adapters)。
>
> **档位 SSOT**：[`scripts/adapter-meta.mjs`](https://github.com/zhinjs/zhin/blob/main/scripts/adapter-meta.mjs)（本页与 [能力分档](/essentials/capability-tiers) 同源）。升档条件见 [ADR 0015](/adr/0015-capability-tier-model)。

## 档位

| 档位 | 含义 |
|------|------|
| **Stable** | 与 `pnpm check:stable`、[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 一致 |
| **Platform Stable** | 主流 IM；须满足 ADR 0015 D3 并进入 `check:stable` Platform 批（**当前无**） |
| **Advanced** | [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 厨房水槽常用；有 integration 测试但不在 Stable smoke |
| **Experimental** | 可用性因部署差异大，需自行验证；**≠ 无测试**，= 无全量 CI/实机承诺 |

## Stable

| 适配器 | 包名 | 文档 |
|--------|------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | [Sandbox](/adapters/sandbox) |

## Platform Stable

_（当前无）_

## Advanced

| 适配器 | 包名 | 文档 |
|--------|------|------|
| 钉钉 | `@zhin.js/adapter-dingtalk` | [钉钉](/adapters/dingtalk) |
| 飞书 | `@zhin.js/adapter-lark` | [飞书](/adapters/lark) |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | [微信公众号](/adapters/wechat-mp) |
| Discord | `@zhin.js/adapter-discord` | [Discord](/adapters/discord) |
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | [ICQQ (QQ)](/adapters/icqq) |
| KOOK | `@zhin.js/adapter-kook` | [KOOK](/adapters/kook) |
| OneBot v11 | `@zhin.js/adapter-onebot11` | [OneBot v11](/adapters/onebot11) |
| QQ 官方 | `@zhin.js/adapter-qq` | [QQ 官方](/adapters/qq) |
| Slack | `@zhin.js/adapter-slack` | [Slack](/adapters/slack) |
| Telegram | `@zhin.js/adapter-telegram` | [Telegram](/adapters/telegram) |

## Experimental

| 适配器 | 包名 | 文档 |
|--------|------|------|
| 企业微信 | `@zhin.js/adapter-wecom` | [企业微信](/adapters/wecom) |
| 微信 iLink | `@zhin.js/adapter-weixin-ilink` | [微信 iLink](/adapters/weixin-ilink) |
| Email | `@zhin.js/adapter-email` | [Email](/adapters/email) |
| GitHub | `@zhin.js/adapter-github` | [GitHub](/adapters/github) |
| LINE | `@zhin.js/adapter-line` | [LINE](/adapters/line) |
| Milky | `@zhin.js/adapter-milky` | [Milky](/adapters/milky) |
| NapCat | `@zhin.js/adapter-napcat` | [NapCat](/adapters/napcat) |
| OneBot v12 | `@zhin.js/adapter-onebot12` | [OneBot v12](/adapters/onebot12) |
| Satori | `@zhin.js/adapter-satori` | [Satori](/adapters/satori) |

## 维护说明

- **单一来源（档位）**：`scripts/adapter-meta.mjs`
- **单一来源（正文）**：`plugins/adapters/<name>/README.md`
- **同步命令**：仓库根目录 `pnpm sync:adapter-docs`
- **CI 检查**：`pnpm check:adapter-docs`、`pnpm check:platform-tiers-ssot`

源码索引：[plugins/adapters/README.md](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/README.md)
