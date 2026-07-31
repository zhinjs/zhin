# Platform Adapters

Adapters connect IM / chat platforms to the Zhin.js core. Each `@zhin.js/adapter-*` package has its **own documentation page**, kept in sync with the in-package `README.md` (`pnpm sync:adapter-docs`).

> For framework-level concepts (multi-platform concurrency, message flow, endpoint lifecycle), see [Core Concepts](/concepts/architecture) and [Endpoint Lifecycle](/authoring/endpoint-lifecycle).
>
> **Tier SSOT**: [`scripts/adapter-meta.mjs`](https://github.com/zhinjs/zhin/blob/main/scripts/adapter-meta.mjs) (same source as docs/snippets/platform-tiers.md).

## Tiers

| Tier | Meaning |
|------|---------|
| **Stable** | Consistent with `pnpm check:stable` and [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) |
| **Platform Stable** | Mainstream IM; must satisfy ADR 0015 D3 and enter the `check:stable` Platform batch (**currently none**) |
| **Advanced** | Commonly used by the [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) maintainer kitchen sink (not a user template); has integration tests but not in the Stable smoke |
| **Experimental** | Usability varies greatly by deployment; requires self-verification; **does not mean untested**, just no full CI / real-device guarantee |

## Stable

| Adapter | Package | Endpoint Management Capabilities | Docs |
|---------|---------|----------------------------------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | — | [Sandbox](/adapters/sandbox) |

## Platform Stable

_(Currently none)_

## Advanced

| Adapter | Package | Endpoint Management Capabilities | Docs |
|---------|---------|----------------------------------|------|
| DingTalk | `@zhin.js/adapter-dingtalk` | — | [DingTalk](/adapters/dingtalk) |
| Lark | `@zhin.js/adapter-lark` | — | [Lark](/adapters/lark) |
| WeChat Official Account | `@zhin.js/adapter-wechat-mp` | — | [WeChat Official Account](/adapters/wechat-mp) |
| Discord | `@zhin.js/adapter-discord` | — | [Discord](/adapters/discord) |
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | listFriends, listGroups, listChannels, listGroupMembers, approveRequest, rejectRequest, kickGroupMember, muteGroupMember, setGroupAdmin, deleteFriend | [ICQQ (QQ)](/adapters/icqq) |
| KOOK | `@zhin.js/adapter-kook` | — | [KOOK](/adapters/kook) |
| OneBot v11 | `@zhin.js/adapter-onebot11` | — | [OneBot v11](/adapters/onebot11) |
| QQ Official | `@zhin.js/adapter-qq` | listChannels | [QQ Official](/adapters/qq) |
| Slack | `@zhin.js/adapter-slack` | — | [Slack](/adapters/slack) |
| Telegram | `@zhin.js/adapter-telegram` | — | [Telegram](/adapters/telegram) |

## Experimental

| Adapter | Package | Endpoint Management Capabilities | Docs |
|---------|---------|----------------------------------|------|
| WeCom | `@zhin.js/adapter-wecom` | — | [WeCom](/adapters/wecom) |
| WeChat iLink | `@zhin.js/adapter-weixin-ilink` | — | [WeChat iLink](/adapters/weixin-ilink) |
| Email | `@zhin.js/adapter-email` | — | [Email](/adapters/email) |
| GitHub | `@zhin.js/adapter-github` | — | [GitHub](/adapters/github) |
| LINE | `@zhin.js/adapter-line` | — | [LINE](/adapters/line) |
| Milky | `@zhin.js/adapter-milky` | — | [Milky](/adapters/milky) |
| NapCat | `@zhin.js/adapter-napcat` | — | [NapCat](/adapters/napcat) |
| OneBot v12 | `@zhin.js/adapter-onebot12` | — | [OneBot v12](/adapters/onebot12) |
| Satori | `@zhin.js/adapter-satori` | — | [Satori](/adapters/satori) |

## Maintenance Notes

- **Single source of truth (tiers)**: `scripts/adapter-meta.mjs`
- **Single source of truth (content)**: `plugins/adapters/<name>/README.md`
- **Sync command**: Run `pnpm sync:adapter-docs` from the repository root
- **CI checks**: `pnpm check:adapter-docs`, `pnpm check:platform-tiers-ssot`

Source index: [plugins/adapters/README.md](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/README.md)
