# @zhin.js/adapter-onebot-events

OneBot v11、NapCat、icqq 等 OneBot 系适配器共用的侧事件（notice / request / meta）归一化。它把平台原始事件映射成 Zhin 的标准 `scene_type` + `sub_type`，并通过 Endpoint 的 `emit` 发出标准的 notice / request / system 事件。

这是给**适配器作者**用的内部库，不是插件：不要写进 `plugins`，也没有配置项。官方的 `adapter-onebot11`、`adapter-onebot12`、`adapter-napcat`、`adapter-qq`、`adapter-icqq` 都依赖它，保证同一类事件在不同适配器上得到相同的事件名。

## 安装

```bash
pnpm add @zhin.js/adapter-onebot-events
```

需要 Node.js `>=22.19.0`；依赖 `@zhin.js/adapter` 与 `@zhin.js/core`。

## 用法

在适配器收到原始事件时调用 `receiveOneBotLikeSideEvent`。它识别 `post_type`（或 `type`）为 `notice`、`request`、`meta_event` 的事件，返回实际派发的种类；不是侧事件时返回 `null`，由你继续按普通消息处理。

```ts
import { receiveOneBotLikeSideEvent } from '@zhin.js/adapter-onebot-events';
import type { EndpointEventEmitter } from '@zhin.js/adapter';

async function onRawEvent(emit: EndpointEventEmitter, raw: Record<string, unknown>) {
  const kind = await receiveOneBotLikeSideEvent(emit, {
    adapter: 'onebot11',      // 适配器名
    endpointKey: 'my-bot',    // 当前 Endpoint
    platform: 'onebot',       // 'onebot' | 'napcat' | 'icqq'，默认 'onebot'
    raw,
    // 仅 request 事件需要：让上层可以同意 / 拒绝加好友、加群请求
    approve: async (flag, remark) => { /* 调用平台 API */ },
    reject: async (flag, reason) => { /* 调用平台 API */ },
  });
  if (kind === null) {
    // 不是 notice / request / meta 事件
  }
}
```

## 导出

| 导出 | 作用 |
| --- | --- |
| `receiveOneBotLikeSideEvent(emit, input)` | 归一化并派发一条侧事件，返回 `'notice' \| 'request' \| 'system' \| null` |
| `mapNoticeParts(platform, raw, options?)` | 把原始 `notice_type` 映射为 `{ scene_type, sub_type }`；`notify`、`essence` 等按 `sub_type` 细分 |
| `mapRequestParts(platform, raw, subType?)` | 把原始 `request_type` 映射为 `{ scene_type, sub_type }` |
| `resolveSideEventDedupeKey(raw, kind)` | 为没有稳定 id 的 notice / request 生成去重键（有 `flag` 时优先用 `flag`） |
| `ONEBOT_NOTICE_PARTS_MAP` | 标准 OneBot `notice_type` → 标准事件的映射表 |
| `ICQQ_NOTICE_OVERRIDES`、`NOTICE_OVERRIDES_BY_FLAVOR` | 各协议与标准 OneBot 的差异覆盖表 |
| 类型 `OneBotLikeRawEvent`、`OneBotLikeSideEventInput`、`SideEventPlatform`、`OneBotEventFlavor` | 原始事件、调用入参与协议名 |

## 协议差异

- 标准 OneBot / NapCat 使用下划线形式的 `notice_type`，如 `group_increase` → `group` / `member_increase`。
- icqq 把它拆成 `notice_type=group` + `sub_type=increase`；传 `platform: 'icqq'` 后按 `group.increase` 查覆盖表，查不到再回退到标准映射。
- 没有登记覆盖表的协议名按标准 OneBot 处理。

## 开发

```bash
pnpm --filter @zhin.js/adapter-onebot-events build
pnpm vitest run packages/im/adapter-onebot-events/tests
```

适配器开发的完整说明见[适配器开发](../../../docs/authoring/adapters.md)。
