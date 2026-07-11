# @zhin.js/adapter-qq

Zhin.js QQ 官方机器人适配器，基于 QQ 官方机器人 API 开发，支持频道、群聊和私聊消息。

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## 扫码添加机器人（/endpoint）

无需手动复制 AppID/AppSecret：在 IM 中由 **master / trusted** 操作员发送命令，适配器会内联调用 QQ 开放平台绑定协议（等价 `@tencent-connect/qqbot-connector`，**不依赖**该 npm 包），扫码成功后：

- 凭据写入项目根 **`.env`**（键名 `QQ_<name>_APPID` / `QQ_<name>_SECRET`）
- `zhin.config.yml` 仅保留 **`${...}` 引用**（与脚手架其它 adapter 一致）
- **`master`** 与 **`aiAccess.users`** 自动设为 `poll_bind_result` 返回的扫码者 OpenID（接口无该字段时回退为发起命令的用户 ID）

| 命令 | 说明 |
|------|------|
| `/endpoint add qq [name]` | 发起扫码绑定；`name` 默认使用 AppID |
| `/endpoint sync` | 将内存 endpoint 写回 `zhin.config.yml` |
| `/endpoint cancel` | 取消进行中的绑定 |
| `/endpoints` | 查看运行时 qq endpoints 在线状态 |
| `/endpoint help` | Endpoint 管理帮助 |

二维码通过 IM `$reply` 发送 `segment.qrcode(url)`；各 Adapter 在 **`$sendMessage`** 内解析该段（IM → `image`，process → 终端 ASCII，GitHub 等 → 文本链接）。

二维码渲染使用 core 的 `segment.qrcode` / `GeneratedQrCode`（`import { segment } from 'zhin.js'` 或 `import { GeneratedQrCode } from 'zhin.js/qrcode'`）。

## AIGC 合规（AI 白名单）

QQ 开放平台限制 AIGC 进入社群场景、禁止面向全量用户开放生成式能力。请配置 **`endpoints[].aiAccess`**（推荐）或全局 **`ai.access`**，仅 gate LLM 回复；斜杠命令、游戏插件等不受影响。

```yaml
endpoints:
  - context: qq
    name: my-bot
    appid: ...
    secret: ...
    aiAccess:
      mode: whitelist
      users: ['QQ用户openid']
      groups: ['QQ群openid']
      denyMessage: 当前未开放 AI，请联系管理员。
```

多 Endpoint 时可分别设置（例如正式服 `whitelist`、沙箱 `open`）。未写 `endpoints[].aiAccess` 时回退到全局 `ai.access`。

- 群/频道未放行：**静默**（不回复 AI）
- 私聊未放行：回复 `denyMessage`
- 白名单：`users` 与 `groups` **OR** 匹配

详见 [内容审查 / AI Access Gate](../../../docs/advanced/content-moderation.md)。

## 配置

### 基础配置

```typescript
import { defineConfig } from 'zhin.js';

export default defineConfig({
  endpoints: [
    {
      context: 'qq',
      name: 'my-qq-bot',
      appid: process.env.QQ_APPID,
      secret: process.env.QQ_SECRET,
      mode: 'middleware',
      application: 'koa',
      webhookPath: '/qq/webhook',
      sandbox: true,
      data_dir: './data',
    },
  ],
  plugins: [
    '@zhin.js/adapter-qq',
  ],
})
```

### 完整配置选项

```typescript
const config: QQEndpointConfig = {
  context: 'qq',
  name: 'my-qq-bot',
  appid: 'YOUR_APPID',         // 机器人 AppID（必需，小写 appid）
  secret: 'YOUR_SECRET',       // 机器人 Secret（必需）
  mode: 'middleware',        // websocket | webhook | middleware（推荐挂 host-router）
  application: 'koa',          // middleware 模式必填
  webhookPath: '/qq/webhook', // middleware 回调路径（完整 URL: {host}:8086/qq/webhook，无 /api 前缀）
  // mode: 'webhook',         // 独立 HTTP 端口模式
  // port: 8087,
  // path: '/qq/webhook',
  platform: 'qq',              // 'qq' | 'qzone' 平台类型
  intents: [                   // 事件订阅意图（qq-official-bot ^1.2 使用 GROUP_AND_C2C_EVENT）
    'GROUP_AND_C2C_EVENT',     // QQ 群 @ 消息 + C2C 私聊（必需）
    'GUILDS',
    'GUILD_MEMBERS',
    'GUILD_MESSAGES',          // 频道私域 @ 消息（公域用 PUBLIC_GUILD_MESSAGES）
    'DIRECT_MESSAGE',
    'PUBLIC_GUILD_MESSAGES',
  ],
  data_dir: './data',          // 数据目录（可选）
  sandbox: false               // 是否为沙箱环境（可选）
}
```

## 入站模式（二选一）

| 模式 | 配置 | 说明 |
|------|------|------|
| **middleware**（推荐） | `mode: middleware` + `application: koa` + `webhookPath` | 挂在 `@zhin.js/host-router`，与 Host **同端口**（如 `8086`） |
| **webhook**（独立端口） | `mode: webhook` + `port` + `path` | `qq-official-bot` 自建 HTTP 服务，需单独暴露端口 |
| websocket | `mode: websocket` | 长连接，无需公网回调 |

### 自定义网关（qq-official-bot ^1.2.2）

经代理或私有部署时，可覆盖官方 token / gateway 接口：

```yaml
# WebSocket 入站：gatewayUrl 与 accessTokenUrl 均生效
- context: qq
  name: my-qq-bot
  mode: websocket
  appid: ${QQ_APPID}
  secret: ${QQ_SECRET}
  accessTokenUrl: https://your-proxy.example.com/app/getAppAccessToken
  gatewayUrl: https://your-proxy.example.com/gateway/bot
  intents:
    - GROUP_AND_C2C_EVENT
```

```yaml
# middleware / webhook：仅 accessTokenUrl 影响出站鉴权（入站走 HTTP 回调，不用 gateway）
- context: qq
  name: my-qq-bot
  mode: middleware
  application: koa
  webhookPath: /qq/webhook
  accessTokenUrl: https://your-proxy.example.com/app/getAppAccessToken
```

- `gatewayUrl` 可为完整 URL 或相对路径（默认 `/gateway/bot`，相对 `api.sgroup.qq.com` baseURL）
- 连接时日志会输出 `op: qq_gateway` 及实际使用的地址

### middleware 回调地址（test-bot 默认）

1. 确保 `plugins` 含 `@zhin.js/host-router`（test-bot 已启用）
2. `zhin.config.yml` 示例见上文 `webhookPath: /qq/webhook`
3. 在 [QQ 开放平台](https://q.qq.com/bot) → **开发 → 回调配置** 填写：

   ```
   https://<你的公网域名>/qq/webhook
   ```

   本地：`http://127.0.0.1:8086/qq/webhook`（经 ngrok / cloudflared 暴露公网即可）。

   > **注意**：Host 的 Console/API 走 `/api/*`（如 `/api/stats`），但适配器 webhook 直接挂在 Router 根路径，**不要**加 `/api` 前缀；填 `/api/qq/webhook` 会命中 Bearer 鉴权，QQ 平台回调会 401。

4. 勾选事件：**群事件**、**C2C 私聊**、**频道事件**（按需）
5. 保存时平台会发 `SIGN_VERIFY` 签名校验，适配器会自动响应

> Host 对含 `/webhook` 的路径**免 Bearer 鉴权**，由 QQ 的 `X-Signature-Ed25519` 验签。

### webhook 独立端口

```yaml
mode: webhook
port: 8087
path: /qq/webhook
```

回调填 `https://<域名>:8087/qq/webhook`（或反代到该端口）。

## 获取配置信息

### 1. 注册 QQ 机器人

1. 访问 [QQ 开放平台](https://q.qq.com/bot)
2. 登录并创建机器人应用
3. 在「开发设置」中获取：
   - **AppID**（配置字段 `appid`）: 机器人应用 ID
   - **Secret**: 机器人密钥（`secret`）
   - **Secret**: 机器人密钥

### 2. 配置权限

在机器人设置中：
- 配置需要的事件订阅
- 设置消息接收模式（公域/私域）
- 添加频道/群聊白名单（如需要）

### 3. 事件订阅（Intents）

可订阅的事件类型：
- `GUILDS` - 频道事件
- `GUILD_MEMBERS` - 成员变动
- `GUILD_MESSAGES` - 频道消息
- `DIRECT_MESSAGE` - 私信消息
- `GROUP_AND_C2C_EVENT` - QQ 群 @ 消息 + C2C 私聊（`GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE`）
- `INTERACTION` - 互动事件

## 使用示例

### 基础消息处理

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return `你好，${result.params.name}！`
  })
)
```

### 频道消息

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 仅处理频道消息
  if (message.$channel.type === 'channel') {
    console.log(`频道消息：${message.$raw}`)
  }
})
```

### 群聊消息

```typescript
import { onGroupMessage } from 'zhin.js'

onGroupMessage(async (message) => {
  console.log(`群聊消息来自：${message.$sender.name}`)
  console.log(`消息内容：${message.$raw}`)
})
```

### 私聊消息

```typescript
import { onPrivateMessage } from 'zhin.js'

onPrivateMessage(async (message) => {
  await message.$reply('收到你的私信了！')
})
```

### 发送不同类型消息

```typescript
addCommand(new MessageCommand('card')
  .action(async (message) => {
    // 发送 Ark 模板卡片
    return {
      type: 'ark',
      template_id: 23,
      kv: [
        { key: '#TITLE#', value: '标题' },
        { key: '#DESC#', value: '描述' },
        { key: '#PROMPT#', value: '提示' }
      ]
    }
  })
)

addCommand(new MessageCommand('embed')
  .action(async (message) => {
    // 发送 Embed 消息
    return {
      type: 'embed',
      title: 'Embed 标题',
      prompt: '消息提示',
      thumbnail: { url: 'https://example.com/image.png' },
      fields: [
        { name: '字段1', value: '值1' }
      ]
    }
  })
)
```

## 消息类型支持

### 接收消息类型

- ✅ 文本消息
- ✅ @ 提及
- ✅ 图片消息
- ✅ 表情消息
- ✅ Ark 模板消息
- ✅ Embed 消息
- ✅ Markdown 消息

### 发送消息类型

- ✅ 文本消息
- ✅ 图片消息
- ✅ Ark 模板消息
- ✅ Embed 富文本消息
- ✅ Markdown 消息
- ✅ 消息引用（回复）

### AI 出站 Markdown（默认开启）

官方已支持全量 Markdown 后，适配器会在 `$sendMessage` 出站前自动把 AI 的纯文本段转为 `msg_type=2` 的 Markdown 消息（保留 leading `reply`）。配置项 `outboundMarkdown`：

| 值 | 行为 |
|---|---|
| `auto`（默认） | 正文含 `**`、列表、代码块等 Markdown 语法时才转换 |
| `true` | 纯文本也走 Markdown |
| `false` | 始终发纯文本（与旧行为一致） |

```yaml
endpoints:
  - context: qq
    name: my-bot
    outboundMarkdown: auto   # 或 true / false
```

含图片/文件等富媒体的多段消息不会合并，避免破坏分条发送。

**图文混排**（文本 + 图片，典型如二维码说明 + `segment.qrcode`）会自动处理：

| 图片类型 | 行为 |
|---|---|
| 公网 `https` URL | 合并为单条 Markdown（`msg_type=2`），图片用 `![说明 #宽 #高](url)` |
| 内联 base64 / data URI（如二维码渲染） | 群聊/私聊先上传 `file_info`，再以 `msg_type=7` 图文混排同条发送 |

`outboundMarkdown: false` 时关闭上述合并，恢复分条发送。

## API 方法

### 基础方法

```typescript
const endpoint = app.adapters.get('qq')?.endpoints.get('你的机器人ID')

// 发送私信
await endpoint.sendPrivateMessage(userId, '消息内容')

// 发送群消息
await endpoint.sendGroupMessage(groupId, '消息内容')

// 发送频道消息
await endpoint.sendGuildMessage(channelId, '消息内容')

// 撤回消息
await endpoint.$recallMessage(messageId)
```

## 消息 ID 格式

本适配器使用特殊的消息 ID 格式来区分不同类型的消息：

- 私信：`private-{userId}:{messageId}`
- 群聊：`group-{groupId}:{messageId}`
- 频道：`channel-{channelId}:{messageId}`
- 私域频道：`direct-{guildId}:{messageId}`

## 注意事项

### 接收模式

- **公域模式 (public)**: 仅接收 @ 机器人的消息
- **私域模式 (private)**: 可接收频道内所有消息（需要申请权限）

### 频率限制

QQ 机器人有严格的频率限制：
- 主动消息：每个用户每天 5 条
- 被动消息（回复）：无限制
- 建议在被动模式下使用（用户 @ 后回复）

### 沙箱环境

开发时可以使用沙箱环境测试：

```typescript
{
  context: 'qq',
  sandbox: true,  // 启用沙箱
  // ...其他配置
}
```

## 常见问题

### Q: 机器人无法收到消息？

A: 检查以下几点：
1. AppID、Secret 是否正确；`intents` 必须含 **`GROUP_AND_C2C_EVENT`**（不是旧名 `GROUP_AT_MESSAGE_CREATE`）
2. **沙箱环境**：在 [QQ 开放平台](https://q.qq.com/bot) → 开发设置 → 沙箱配置，把测试 **QQ 群** 加入沙箱白名单（私聊能通不代表群已配置）
3. 机器人是否已被拉入该 QQ 群（日志应出现 `qq notice group.add_robot`）
4. 群管理员是否在机器人资料页 **开启消息接收**（`qq notice group.msg_receive_open`）；若出现 `group.msg_receive_close` 则群聊不会推送
5. 公域/群聊场景必须 **@ 机器人** 才会推送（`GROUP_AT_MESSAGE_CREATE`）
6. **QQ 频道** 与 **QQ 群** 是两套事件：频道 @ 需要 `GUILD_MESSAGES` 或 `PUBLIC_GUILD_MESSAGES`，不是 `GROUP_AND_C2C_EVENT`

### Q: Typing Indicator 群聊报 `40034105 主动消息失败, 无权限`？

A: QQ **群聊**不允许无引用的主动消息。框架已对 QQ 群场景的「正在处理中…」自动附带 `reply` 引用触发消息；若仍失败，可在 Endpoint 配置中关闭群聊 typing：

```yaml
typingIndicator:
  enabled: true
  groupConfig:
    type: none
```

### Q: 发送消息失败？

A: 可能的原因：
1. 超过主动消息频率限制
2. 没有对应频道/群的发送权限
3. 消息格式不符合规范
4. Token 已过期或失效

### Q: 如何处理不同平台？

A: 使用 `platform` 配置：
- `qq`: QQ 频道和群聊
- `qzone`: QQ 空间（如支持）

## 相关链接

- [QQ 开放平台](https://q.qq.com/bot)
- [QQ 机器人开发文档](https://bot.q.qq.com/wiki/)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具（8 个） | `agent/tools/`（`qq_*`：公会、频道、角色等） |
| 技能说明 | `agent/skills/qq.md` |
| 群管标准工具 | `createSceneManagementTools()` |


## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
