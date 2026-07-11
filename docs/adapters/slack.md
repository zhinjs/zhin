---
title: "@zhin.js/adapter-slack"
package: "@zhin.js/adapter-slack"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/slack/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/slack/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=6cc641e1cf75f175 -->

# @zhin.js/adapter-slack

Zhin.js 的 Slack 适配器，支持消息收发、Block Kit 交互与 Assistant API。

## 安装

```bash
pnpm add @zhin.js/adapter-slack
```

## 配置

通过 **`socketMode`** 选择连接方式。

### 模式对比

| 模式 | `socketMode` | 适用场景 | 额外字段 |
|------|--------------|----------|----------|
| **Socket Mode** | `true`（推荐本地/内网） | 无需公网 URL，WebSocket 长连接 | `appToken`（`xapp-...`） |
| **HTTP Events** | `false` | 生产环境，有公网 HTTPS | 共享 zhin router 端口 8086 |

### Socket Mode（推荐开发环境）

可选 `clientPingTimeout`（毫秒，默认 `15000`）用于调整 Socket Mode 客户端心跳超时，减少误报 pong 警告。

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  endpoints: [
    {
      name: 'my-slack-bot',
      context: 'slack',
      token: 'xoxb-your-bot-token',
      signingSecret: 'your-signing-secret',
      appToken: 'xapp-your-app-token',
      socketMode: true
    }
  ]
})
```

### HTTP 模式（生产环境，使用 zhin Router）

HTTP 模式共享 zhin.js 内置的 Koa Router（默认端口 8086），无需额外监听端口。

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  endpoints: [
    {
      name: 'my-slack-bot',
      context: 'slack',
      token: 'xoxb-your-bot-token',
      signingSecret: 'your-signing-secret',
      socketMode: false
    }
  ]
})
```

**HTTP 模式前置条件：**

- Slack App 中配置 **Event Subscriptions** 的 Request URL 为 `https://your-domain:8086/slack/events`
- 配置 **Interactivity & Shortcuts** 的 Request URL 为同一地址
- 配置 **Slash Commands** 的 Request URL 为同一地址
- 防火墙 / 反向代理放行端口

## 功能特性

- 收发文本消息
- 富媒体（图片、文件），经 `files.uploadV2` 上传
- 消息格式化（Slack mrkdwn + Block Kit）
- 回复消息与线程（`thread_ts`）
- 提及（@用户、#频道）
- 链接与附件
- Socket Mode 与 HTTP 模式（共享 zhin router）
- 私信与频道消息
- Block Kit 交互按钮（`keyboard` 片段 → 原生 Slack 按钮）
- 斜杠命令 → zhin Command 映射
- 消息编辑（`$editMessage` / `chat.update`）
- Notice 事件映射（`member_joined`、`reaction_added`、`pin_added` 等）
- Assistant API 支持（`assistant_thread_started` 事件）
- 出站 Markdown → Slack mrkdwn 自动转换（`**粗体**` → `*粗体*`）
- 长消息自动分段（超 2900 字符切 section；超 48 blocks 分多条发送）
- 斜杠命令即时 ephemeral 反馈（「处理中…」）；最终回复仍 `chat.postMessage`
- 按钮点击即时 ephemeral 反馈（「已收到」）
- 入站 Slack mrkdwn → 通用 Markdown（粗体/斜体/删除线/代码/链接）

## 消息格式

### 出站（Markdown → mrkdwn）

AI 或命令输出的通用 Markdown（如 `**粗体**`、`*斜体*`）会自动转换为 Slack mrkdwn，并通过 Block Kit `section` 块发送，确保在 Slack 客户端正确渲染。

### 长消息

- 单条 `section` 文本超过约 2900 字符时自动切分为多个 section
- 单条消息 blocks 超过 48 个时自动拆分为多条 `chat.postMessage`

### 入站（mrkdwn → Markdown）

用户发送的 Slack mrkdwn 在解析为 `text` 段前会转换为通用 Markdown：

| Slack mrkdwn | 通用 Markdown |
|--------------|---------------|
| `*bold*` | `**bold**` |
| `_italic_` | `*italic*` |
| `~strike~` | `~~strike~~` |
| `` `code` `` | 保持 |
| `<url\|text>` | `[text](url)` |

`<@U>` / `<#C>` 等特殊段仍由专用解析器处理，不在此转换。该转换为启发式，复杂嵌套格式不保证完美往返。

## 交互反馈

### 斜杠命令

收到斜杠命令后，适配器会立即向触发者发送 ephemeral「处理中…」（仅触发者可见）。命令处理完成后的最终回复仍通过 `chat.postMessage` 发送到频道，与现有 `$reply` 行为一致。

### Block Kit 按钮

用户点击 `block_actions` 按钮后，适配器会向点击者发送 ephemeral「已收到」。如需在线程中回复，仍通过 `sendMessage`（`thread_ts`）发送。

## 创建 Slack App

1. 前往 [Slack API](https://api.slack.com/apps)
2. 创建新应用
3. 添加 Bot Token Scopes：
   - `chat:write` — 发送消息
   - `chat:write.public` — 向公开频道发送消息
   - `channels:read` — 查看频道基本信息
   - `channels:history` — 查看频道消息历史
   - `channels:manage` — 管理频道
   - `groups:read` — 查看私有频道基本信息
   - `groups:history` — 查看私有频道消息历史
   - `im:read` — 查看私信基本信息
   - `im:history` — 查看私信消息历史
   - `mpim:read` — 查看群组私信基本信息
   - `mpim:history` — 查看群组私信消息历史
   - `users:read` — 查看用户信息
   - `files:read` — 查看文件
   - `files:write` — 上传文件
   - `reactions:read` — 查看表情回应
   - `reactions:write` — 添加/移除表情回应
   - `pins:read` — 查看置顶项
   - `pins:write` — 置顶/取消置顶消息
   - `commands` — 添加斜杠命令
   - `assistant:write` — Assistant API（若使用 AI 功能）
4. 启用 Socket Mode（若使用 Socket Mode）：
   - 进入 Socket Mode 设置
   - 启用 Socket Mode
   - 生成带 `connections:write` scope 的应用级 Token
5. 订阅 Bot 事件：
   - `message.channels` — 公开频道消息
   - `message.groups` — 私有频道消息
   - `message.im` — 私信
   - `message.mpim` — 群组私信
   - `app_mention` — Bot 被 @ 提及时
   - `member_joined_channel` — 用户加入频道
   - `member_left_channel` — 用户离开频道
   - `reaction_added` — 添加表情回应
   - `reaction_removed` — 移除表情回应
   - `channel_archive` / `channel_unarchive`
   - `channel_rename` / `channel_created` / `channel_deleted`
   - `pin_added` / `pin_removed`
   - `team_join` — 新用户加入工作区
   - `assistant_thread_started`（若使用 Assistant API）
   - `assistant_thread_context_changed`（若使用 Assistant API）
6. 将应用安装到工作区
7. 复制 Bot User OAuth Token（`xoxb-...`）
8. 复制 Signing Secret
9. 若使用 Socket Mode，复制 App-Level Token（`xapp-...`）

## 使用示例

### 基础消息处理

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello from Slack!'
  })
)
```

### 发送带 Block Kit 按钮的富消息

```typescript
addCommand(new MessageCommand('vote')
  .action(async (message) => {
    return [
      { type: 'text', data: { text: 'What do you think?' } },
      {
        type: 'keyboard',
        data: {
          rows: [[
            { label: 'Approve', id: 'vote_yes', style: 'primary' },
            { label: 'Reject', id: 'vote_no', style: 'danger' },
          ]]
        }
      }
    ]
  })
)
```

### 在线程中回复

```typescript
addCommand(new MessageCommand('thread')
  .action(async (message) => {
    await message.$reply('This is a threaded reply!', true)
  })
)
```

### 编辑消息

适配器支持 core `EditMessageOptions` 契约。`messageId` 优先使用 `channel:ts` 格式；若仅为 `ts`，则使用 `options.id` 作为 channel。

```typescript
const adapter = inject('slack')

// 旧 API（薄封装，仍可用）
await adapter.editMessage('my-slack-bot', 'C001', '1700000000.000000', [
  { type: 'text', data: { text: 'Updated message content' } }
])

// core 契约（推荐）
await adapter.editMessage({
  messageId: 'C001:1700000000.000000',
  context: 'slack',
  endpoint: 'my-slack-bot',
  id: 'C001',
  type: 'group',
  content: [{ type: 'text', data: { text: 'Updated message content' } }],
})
```

## Slack MCP Server 集成

如果你的 zhin 实例使用了 `@zhin.js/agent`（AI 功能），可以将 Slack MCP Server 配置为 AI 的工具来源：

```typescript
export default defineConfig({
  ai: {
    mcpServers: {
      slack: {
        command: 'npx',
        args: ['-y', '@anthropic/slack-mcp-server'],
        env: {
          SLACK_BOT_TOKEN: 'xoxb-your-bot-token',
          SLACK_TEAM_ID: 'T0123456789'
        }
      }
    }
  }
})
```

这将使 AI Agent 获得搜索 Slack 消息、管理频道等额外能力。

## Notice 事件映射

| Slack 事件 | zhin Notice 类型 |
|---|---|
| `member_joined_channel` | `notice.group.member_increase` |
| `member_left_channel` | `notice.group.member_decrease` |
| `reaction_added` / `reaction_removed` | `notice.group.emoji_reaction` |
| `message_deleted` | `notice.group.recall` |
| `team_join` | `notice.friend.increase` |
| `channel_archive` | `notice.slack.channel_archive` |
| `pin_added` / `pin_removed` | `notice.slack.pin_added` / `notice.slack.pin_removed` |

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具（11 个） | `agent/tools/`（`slack_*`：邀请、话题、反应、置顶等） |
| 技能说明 | `agent/skills/slack.md` |
| 群管标准工具 | `createSceneManagementTools()` |


## 限制

- 入站 mrkdwn → Markdown 为启发式转换，复杂嵌套格式不保证完美往返
- Modals / `view_submission` / `view_closed` — 暂不支持
- Select menus / options load — 暂不支持
- File 事件全系列（`file_created` / `file_shared` 等）— 暂不支持
- OAuth 安装流程 — 暂不支持

## 许可证

MIT
