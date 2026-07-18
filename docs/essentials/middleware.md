# 中间件与消息调度

> **级别：L2～L3**。若尚未了解消息如何进入框架，请先读 [消息如何流转](./message-flow.md)。

中间件是 `middlewares/` 目录下的 `.ts` 文件，默认导出 `defineMiddleware(...)`。它以**洋葱模型**包裹消息的入站/出站处理：每个中间件可以放行（`next()`）、改写、或直接终止链路。

## 消息处理架构

入站消息的处理顺序：

```
平台 Adapter → Runtime Message
  → inbound 中间件链（洋葱模型，中间件注册的插件各自提供一段）
      → 终端：MessageDispatcher —— 以 / 开头的消息匹配命令并回复
          → 未命中命令 → AI（如已启用）
```

出站回复（命令返回值、`$reply`、Host 主动推送）统一走：

```
SendContent → 渲染（Rich Segment 等）→ outbound 中间件链 → Adapter 发送到平台
```

要点：

- 中间件在**命令匹配之前**运行，因此可以拦截、改写或吞掉一条消息。
- 不调用 `next()` 即终止链路：命令不会执行，AI 也不会触发。
- `next()` 最多调用一次，重复调用会抛错。

## 写一个中间件

在插件（或项目根）创建 `middlewares/` 目录：

```typescript
// middlewares/logger.ts
import { defineMiddleware } from '@zhin.js/middleware'
import type { Message } from '@zhin.js/core/runtime'

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle({ input }, next) {
    const start = Date.now()
    await next()
    console.log(`[${input.target}] 处理耗时 ${Date.now() - start}ms`)
  },
})
```

目录可以嵌套组织（如 `middlewares/admin/guard.ts`）；目录与文件名只认 `[a-z0-9][a-z0-9-]*`。文件即中间件，无需手动注册，热重载自动生效。

`defineMiddleware` 的选项：

| 字段 | 取值 | 默认值 | 说明 |
|------|------|--------|------|
| `target` | `'inbound'` / `'outbound'` | `'inbound'` | 入站消息链 / 出站发送链 |
| `phase` | `'before-dispatch'` / `'after-dispatch'` | `'before-dispatch'` | 在调度处理之前还是之后执行本段 |
| `order` | 整数 | `0` | 同 phase 内的执行顺序（小在前） |

## Runtime Message

入站中间件的 `context.input` 是 Runtime `Message`，与旧 API 的字段不同：

| 字段 | 说明 |
|------|------|
| `content` | 消息文本（**没有 `$raw`**，用它代替） |
| `target` | 会话标识（群/私聊目标） |
| `sender` | 发送者 id（可空；**没有 `$sender` 对象**） |
| `metadata` | 平台附加信息（如 `type` / `channelType`，因适配器而异；**没有 `$channel`**） |
| `adapter` | 来源适配器的 Capability id |
| `$reply(content)` | 在入站处理期间回复本会话 |

::: warning 迁移注意
旧中间件里的 `message.$raw` / `message.$channel` / `message.$sender.id` 在 Runtime Message 上**不存在**：文本用 `content`，会话类型从 `metadata` 判断，发送者用 `sender`。
:::

`context` 上还带着能力通用字段：`config`（本插件配置）、`owner`、`generation`、`use(token)`（Host Resources，见 [插件系统](./plugins#host-resources)）。

## 拦截与回复

不调用 `next()` 即可吞掉消息；`input.$reply(...)` 回复后直接结束：

```typescript
// middlewares/echo-guard.ts（形态参考 plugins/utils/repeater）
import { defineMiddleware } from '@zhin.js/middleware'
import type { Message } from '@zhin.js/core/runtime'

export default defineMiddleware<Message>({
  async handle({ input }, next) {
    if (input.content.trim() === 'stop') {
      await input.$reply('已停止')
      return // 终止链路：命令与 AI 都不会执行
    }
    await next()
  },
})
```

## 出站中间件

`target: 'outbound'` 的中间件包裹每一次发送，`input` 是 `OutboundEnvelope`：

| 字段 | 说明 |
|------|------|
| `payload` | 渲染后的待发内容（平台段结构） |
| `replace(payload)` | 整体替换待发内容（润色、审查改写） |
| `adapter` / `target` / `requester` | 目标适配器、会话、发起方插件 |

```typescript
// middlewares/outbound-censor.ts
import { defineMiddleware } from '@zhin.js/middleware'
import type { OutboundEnvelope } from '@zhin.js/core/runtime'

export default defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  async handle({ input }, next) {
    if (typeof input.payload === 'string' && input.payload.includes('敏感词')) {
      input.replace('（内容已折叠）')
    }
    await next()
  },
})
```

## 排序规则

多条中间件的执行顺序依次按以下键排序（见 `MiddlewareIndex`）：

1. **phase**：`before-dispatch` 全部先于 `after-dispatch`；
2. **order**：数值小的在前（默认 `0`）；
3. **插件拓扑序**：父插件的中间件先于子插件；
4. **capability id**：字典序兜底。

经验法则：日志/计时用默认 order；需要在其他中间件之前拦截的（如鉴权）给负数 order。

## 完整示例

```typescript
// middlewares/access-log.ts
import { defineMiddleware } from '@zhin.js/middleware'
import type { Message } from '@zhin.js/core/runtime'

interface Config {
  blockedSenders?: string[]
}

export default defineMiddleware<Message, Config>({
  order: -10,
  async handle({ input, config }, next) {
    const blocked = config.blockedSenders ?? []
    if (input.sender && blocked.includes(input.sender)) {
      return // 静默丢弃
    }
    console.log(`[inbound] ${input.sender ?? 'unknown'}: ${input.content}`)
    await next()
  },
})
```

::: info legacy 路径
旧的 `root.addMiddleware` / `dispatcher.addGuardrail`（`$raw` / `$channel` 形态）属于旧 Feature registry（`zhin dev` 路径）；新项目请使用 `middlewares/` 约定目录。
:::

## 下一步

- [命令系统](./commands) — 中间件链终端的命令匹配
- [消息如何流转](./message-flow) — 入站/出站全链路
- [plugins/utils/repeater](https://github.com/zhinjs/zhin/tree/main/plugins/utils/repeater) — middleware + command 的真实插件
