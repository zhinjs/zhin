# 平台适配器

适配器把外部平台接入 Zhin 的统一消息与 Endpoint 模型。先按部署条件选择接入方式，再检查能力和维护档位；不要只按平台名称选包。

## 先做选择

| 你的条件 | 优先方向 | 代表适配器 |
| --- | --- | --- |
| 先验证业务，不接真实账号 | 本地 Sandbox | Sandbox |
| 平台提供官方 Bot / App API | 官方连接 | QQ 官方、Discord、Telegram、Slack、钉钉、飞书、微信公众号 |
| 已部署协议桥或网关 | 网关连接 | OneBot v11；NapCat、Milky、OneBot v12 等需自行验收 |
| 事件天然来自协作系统 | 工作项连接 | GitHub（Experimental） |
| 入口不是即时聊天 | 非聊天消息源 | Email（Experimental） |

选择前确认五件事：凭据由谁保管、平台如何投递入站事件、是否需要撤回或成员管理、部署环境能否接收回调，以及该档位是否满足你的发布标准。

## 推荐接入流程

1. 用 `npx zhin setup --adapters` 选择并生成适配器配置。
2. 执行 `pnpm install` 与 `pnpm dev`，先让 Sandbox 黄金路径通过。
3. 在 Console 的“会话与频道”确认入站，在“运行时能力”核对 Endpoint 操作，在“日志”完成故障定位。
4. 把真实平台加入同一业务链；命令、组件和中间件不应读取平台私有 SDK。

每个 `@zhin.js/adapter-*` 包都有独立文档页，并与包内 `README.md` 同步。下方档位与能力表是发布事实，不是推荐榜单。

> 框架级概念（多平台同跑、消息流、端点生命周期）见 [核心概念](/concepts/architecture) 与 [端点生命周期](/authoring/endpoint-lifecycle)。
>
> **档位 SSOT**：[`scripts/adapter-meta.mjs`](https://github.com/zhinjs/zhin/blob/main/scripts/adapter-meta.mjs)（与 docs/snippets/platform-tiers.md 同源）。

## 档位

| 档位 | 含义 |
|------|------|
| **Stable** | 与 `pnpm check:stable`、[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 一致 |
| **Platform Stable** | 主流 IM；须满足 ADR 0015 D3 并进入 `check:stable` Platform 批（**当前无**） |
| **Advanced** | [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 维护者厨房水槽（非用户模板）常用；有 integration 测试但不在 Stable smoke |
| **Experimental** | 可用性因部署差异大，需自行验证；**≠ 无测试**，= 无全量 CI/实机承诺 |

## Stable

| 适配器 | 包名 | Endpoint 管理能力 | 文档 |
|--------|------|-------------------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | — | [Sandbox](/adapters/sandbox) |

## Platform Stable

_（当前无）_

## Advanced

| 适配器 | 包名 | Endpoint 管理能力 | 文档 |
|--------|------|-------------------|------|
| 钉钉 | `@zhin.js/adapter-dingtalk` | — | [钉钉](/adapters/dingtalk) |
| 飞书 | `@zhin.js/adapter-lark` | — | [飞书](/adapters/lark) |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | — | [微信公众号](/adapters/wechat-mp) |
| Discord | `@zhin.js/adapter-discord` | — | [Discord](/adapters/discord) |
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | listFriends, listGroups, listChannels, listGroupMembers, listRequests, approveRequest, rejectRequest, kickGroupMember, muteGroupMember, setGroupAdmin, deleteFriend | [ICQQ (QQ)](/adapters/icqq) |
| KOOK | `@zhin.js/adapter-kook` | — | [KOOK](/adapters/kook) |
| OneBot v11 | `@zhin.js/adapter-onebot11` | — | [OneBot v11](/adapters/onebot11) |
| QQ 官方 | `@zhin.js/adapter-qq` | listChannels | [QQ 官方](/adapters/qq) |
| Slack | `@zhin.js/adapter-slack` | — | [Slack](/adapters/slack) |
| Telegram | `@zhin.js/adapter-telegram` | — | [Telegram](/adapters/telegram) |

## Experimental

| 适配器 | 包名 | Endpoint 管理能力 | 文档 |
|--------|------|-------------------|------|
| 企业微信 | `@zhin.js/adapter-wecom` | — | [企业微信](/adapters/wecom) |
| 微信 iLink | `@zhin.js/adapter-weixin-ilink` | — | [微信 iLink](/adapters/weixin-ilink) |
| Email | `@zhin.js/adapter-email` | — | [Email](/adapters/email) |
| GitHub | `@zhin.js/adapter-github` | — | [GitHub](/adapters/github) |
| LINE | `@zhin.js/adapter-line` | — | [LINE](/adapters/line) |
| Milky | `@zhin.js/adapter-milky` | — | [Milky](/adapters/milky) |
| NapCat | `@zhin.js/adapter-napcat` | — | [NapCat](/adapters/napcat) |
| OneBot v12 | `@zhin.js/adapter-onebot12` | — | [OneBot v12](/adapters/onebot12) |
| Satori | `@zhin.js/adapter-satori` | — | [Satori](/adapters/satori) |

## 统一消息操作能力

消息发送由所有声明 **outbound** 的 Endpoint 支持；消息级扩展操作通过统一
**EndpointControl** 暴露，并按每个具体 Endpoint 精确声明。Core 不探测平台 SDK 私有方法。

| 操作 | 已接入平台 |
|------|------------|
| recall | Discord、ICQQ、KOOK、飞书、Milky、NapCat、OneBot 11/12、QQ 官方、Satori、Slack、Telegram、企业微信 |
| edit | Slack |
| reaction | Discord Gateway、ICQQ、Slack |
| typing | 微信 iLink |

同一适配器不同接入模式可以具有不同能力。例如 Discord Gateway 支持 reaction，
Interactions 模式只声明 recall；Host/Console 可从 Endpoint row 的 **operations** 字段读取
当前模式的准确能力集。

## 维护说明

- **单一来源（档位）**：`scripts/adapter-meta.mjs`
- **单一来源（正文）**：`plugins/adapters/<name>/README.md`
- **同步命令**：仓库根目录 `pnpm sync:adapter-docs`
- **CI 检查**：`pnpm check:adapter-docs`、`pnpm check:platform-tiers-ssot`

源码索引：[plugins/adapters/README.md](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/README.md)
