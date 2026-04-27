# 队列事件与 IM 字段对齐（契约）

目的：双栈（IM 与队列机器人）并存时，**同一语义使用相同或显式映射的字段名**，避免 Agent 与文档各写一套键。

## IM 侧权威类型（`@zhin.js/core`）

### 入站 `Message`（节选）

见 `packages/core/src/message.ts` — `MessageBase`：

| 字段 | 含义 |
|------|------|
| `$adapter` | 适配器名（ keyof Adapters ） |
| `$bot` | Bot 实例标识 |
| `$channel.id` / `$channel.type` | 会话 id、`group` \| `private` \| `channel` |
| `$sender` | `MessageSender`（`id`、可选 `name` / `role`） |
| `$content` / `$raw` | 结构化内容 / 纯文本 |
| `$reply(content)` | **推荐出站 API**（走 Adapter 链） |

### 出站 `SendOptions`（`types.ts`）

| 字段 | 含义 |
|------|------|
| `context` | 适配器上下文名（与 `$adapter` 同源语义） |
| `bot` | Bot 名 |
| `id` | 目标会话或用户 id（与 `$channel.id` 对齐） |
| `type` | `MessageType`，与 `$channel.type` 对齐 |
| `content` | `SendContent` |

### 出站润色

| 字段 | 含义 |
|------|------|
| `OutboundReplySource` | `'command' \| 'ai'`（仅 `replyWithPolish` 路径带 AsyncLocalStorage） |

## 队列侧（约定 / 占位）

当引入 **qbot / 双队列** 时，建议在事件 `detail` 或 job payload 中显式携带：

| 语义 | 建议键名 | 对应 IM |
|------|-----------|---------|
| 适配器/上下文 | `context` 或 `adapter`（二选一，**全仓库统一**） | `SendOptions.context` / `Message.$adapter` |
| Bot | `bot` | `SendOptions.bot` / `Message.$bot` |
| 目标 id | `channelId` 或 `id`（**统一**） | `SendOptions.id` |
| 频道类型 | `channelType` 或 `type`（**统一**） | `SendOptions.type` |
| 发送者 | `senderId` | `Message.$sender.id` |
| 正文 | `content` 或 `text`（**统一**） | `SendOptions.content` / `Message.$raw` |

**规则**：新代码禁止混用 `sceneId`/`roomId`/`peerId` 等不与上表映射表对照的裸键；若平台必须用异名，在适配层做 **一次性** 映射并文档化。

## 相关

- [event-contracts.md](./event-contracts.md) — 队列事件 kind/type/detail 推荐形状  
- [im-queue-outbound-invariants.md](./im-queue-outbound-invariants.md) — 出站勿绕开  
