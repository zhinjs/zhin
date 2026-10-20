# 平台适配器

本目录包含 Zhin 的平台连接包。档位的唯一来源是 [`scripts/adapter-meta.mjs`](../../scripts/adapter-meta.mjs)；下表只做包索引，不重复维护易失真的档位副本。

| 适配器 | npm 包 | 说明 |
|--------|--------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | 本地调试；minimal-bot 默认 |
| ICQQ / QQ 官方 | `@zhin.js/adapter-icqq` / `@zhin.js/adapter-qq` | QQ 生态连接 |
| OneBot v11 / v12 | `@zhin.js/adapter-onebot11` / `@zhin.js/adapter-onebot12` | OneBot 协议连接 |
| NapCat / Milky / Satori | 对应 `@zhin.js/adapter-*` | 第三方网关协议 |
| Discord / Telegram / Slack / KOOK | 对应 `@zhin.js/adapter-*` | 社区与协作平台 |
| 钉钉 / 飞书 / 企业微信 | 对应 `@zhin.js/adapter-*` | 企业协作平台 |
| 微信公众号 / 微信 iLink | 对应 `@zhin.js/adapter-*` | 微信生态连接 |
| LINE / Email / GitHub | 对应 `@zhin.js/adapter-*` | 其他消息与事件源 |

## 档位含义

- **Stable（Core）**：`pnpm check:stable` Core 批、minimal-bot；Sandbox 入站 + 核心 Agent 契约。
- **Platform Stable**：满足 ADR 0015 D3 并进入 `check:stable` Platform 批；当前为空。
- **Advanced**：test-bot（维护者厨房水槽，非用户模板）中常用；实机与 LLM 见 [ACCEPTANCE Advanced](../../examples/test-bot/ACCEPTANCE.md)。
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
