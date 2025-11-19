# @zhin.js/adapter-qq

Zhin.js QQ 官方机器人适配器，基于 QQ 官方机器人 API 开发，支持频道、群聊和私聊消息。

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## 配置

### 基础配置

```typescript
import { defineConfig } from 'zhin.js';

export default defineConfig({
  bots: [
    {
      context: 'qq',
      name: '你的机器人ID', // 机器人的 AppID
      appID: process.env.QQ_APP_ID,
      token: process.env.QQ_TOKEN,
      secret: process.env.QQ_SECRET,
      mode: 'public', // 或 'private'
      platform: 'qq', // 'qq' | 'qzone'
      data_dir: './data' // 数据存储目录
    }
  ],
  plugins: [
    'http',
    'adapter-qq'
  ]
})
```

### 完整配置选项

```typescript
const config: QQBotConfig = {
  context: 'qq',
  name: '机器人ID',
  appID: 'YOUR_APP_ID',        // 机器人 AppID（必需）
  token: 'YOUR_TOKEN',         // 机器人 Token（必需）
  secret: 'YOUR_SECRET',       // 机器人 Secret（必需）
  mode: 'public',              // 'public' | 'private' 接收模式
  platform: 'qq',              // 'qq' | 'qzone' 平台类型
  intents: [                   // 事件订阅意图
    'GUILDS',
    'GUILD_MEMBERS',
    'DIRECT_MESSAGE',
    'GROUP_AT_MESSAGE_CREATE'
  ],
  data_dir: './data',          // 数据目录（可选）
  sandbox: false               // 是否为沙箱环境（可选）
}
```

## 获取配置信息

### 1. 注册 QQ 机器人

1. 访问 [QQ 开放平台](https://q.qq.com/bot)
2. 登录并创建机器人应用
3. 在「开发设置」中获取：
   - **AppID**: 机器人应用 ID
   - **Token**: 机器人令牌
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
- `GROUP_AT_MESSAGE_CREATE` - 群聊 @ 消息
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

## API 方法

### 基础方法

```typescript
const bot = app.adapters.get('qq')?.bots.get('你的机器人ID')

// 发送私信
await bot.sendPrivateMessage(userId, '消息内容')

// 发送群消息
await bot.sendGroupMessage(groupId, '消息内容')

// 发送频道消息
await bot.sendGuildMessage(channelId, '消息内容')

// 撤回消息
await bot.$recallMessage(messageId)
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
1. AppID、Token、Secret 是否正确
2. 事件订阅（Intents）是否包含对应类型
3. 公域模式下消息是否 @ 了机器人
4. 机器人是否已加入对应频道/群聊

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

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
