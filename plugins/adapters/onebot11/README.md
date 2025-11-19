# @zhin.js/adapter-onebot11

Zhin.js OneBot v11 协议适配器，通过 WebSocket 连接各种支持 OneBot 协议的 QQ 机器人实现（如 go-cqhttp、Shamrock、LagrangeGo 等）。

## 功能特性

- 🔌 完整 OneBot v11 协议兼容
- 🌐 WebSocket 客户端和服务器模式
- 🔐 Access Token 认证支持
- 🔄 自动重连机制
- 💓 心跳检测
- 📨 群聊和私聊消息处理
- 🛠️ 完整的 API 调用支持
- 📝 消息段（Message Segment）完整支持

## 安装

```bash
pnpm add @zhin.js/adapter-onebot11 ws
```

## 配置

### WebSocket 客户端模式（正向 WS）

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'onebot11',
      type: 'ws',                            // WebSocket 客户端
      name: 'my-bot',
      url: 'ws://localhost:8080',            // OneBot 服务地址
      access_token: process.env.ONEBOT_TOKEN, // 访问令牌（可选）
      reconnect_interval: 5000,              // 重连间隔（毫秒）
      heartbeat_interval: 30000              // 心跳间隔（毫秒）
    }
  ],
  plugins: [
    'adapter-onebot11'
  ]
})
```

### WebSocket 服务器模式（反向 WS）

```typescript
export default defineConfig({
  bots: [
    {
      context: 'onebot11.wss',               // WebSocket 服务器
      type: 'ws_reverse',
      name: 'my-bot',
      path: '/onebot/ws',                    // WebSocket 路径
      access_token: process.env.ONEBOT_TOKEN, // 访问令牌（可选）
      heartbeat_interval: 30000
    }
  ],
  plugins: [
    'http',                                   // 需要 HTTP 服务
    'adapter-onebot11'
  ]
})
```

## 支持的 OneBot 实现

### 推荐实现

| 实现 | 协议支持 | 稳定性 | 推荐度 |
|------|---------|--------|--------|
| [go-cqhttp](https://github.com/Mrs4s/go-cqhttp) | ✅ 完整 | ⭐⭐⭐⭐⭐ | 高 |
| [LagrangeGo](https://github.com/LagrangeDev/Lagrange.Core) | ✅ 完整 | ⭐⭐⭐⭐ | 高 |
| [Shamrock](https://github.com/whitechi73/OpenShamrock) | ✅ 完整 | ⭐⭐⭐⭐ | 中 |
| [NapCat](https://github.com/NapNeko/NapCatQQ) | ✅ 完整 | ⭐⭐⭐⭐ | 中 |

### 配置示例

#### go-cqhttp

```yaml
# config.yml
servers:
  - ws:
      host: 0.0.0.0
      port: 8080
      access-token: "your_token_here"
```

#### Shamrock

在 Shamrock 设置中：
1. 启用 WebSocket 服务
2. 设置端口（默认 5800）
3. 配置 Access Token（可选）

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

### 群聊消息

```typescript
import { onGroupMessage } from 'zhin.js'

onGroupMessage(async (message) => {
  console.log(`群 ${message.$channel.id} 收到消息`)
  await message.$reply('收到了！')
})
```

### 私聊消息

```typescript
import { onPrivateMessage } from 'zhin.js'

onPrivateMessage(async (message) => {
  await message.$reply('你好！')
})
```

### 发送图片

```typescript
addCommand(new MessageCommand('pic <url:text>')
  .action(async (message, result) => {
    return [
      { type: 'image', data: { file: result.params.url } }
    ]
  })
)
```

### 使用 CQ 码

```typescript
addCommand(new MessageCommand('cq')
  .action(async (message) => {
    return [
      { type: 'face', data: { id: '123' } },
      { type: 'text', data: { text: '表情' } }
    ]
  })
)
```

## 消息类型支持

### 接收消息类型

- ✅ 文本消息（text）
- ✅ 图片消息（image）
- ✅ 语音消息（record）
- ✅ 视频消息（video）
- ✅ @ 提及（at）
- ✅ 表情（face）
- ✅ 引用回复（reply）
- ✅ 戳一戳（poke）
- ✅ 分享（share）
- ✅ 位置（location）
- ✅ 音乐分享（music）
- ✅ JSON 卡片（json）
- ✅ XML 卡片（xml）

### 发送消息类型

- ✅ 文本消息
- ✅ 图片消息（支持 URL、Base64、本地文件）
- ✅ 语音消息
- ✅ 视频消息
- ✅ @ 提及
- ✅ 表情
- ✅ 引用回复
- ✅ 戳一戳
- ✅ 分享卡片
- ✅ 音乐分享
- ✅ JSON/XML 卡片

## API 方法

### 消息相关

```typescript
const bot = app.adapters.get('onebot11')?.bots.get('my-bot')

// 发送群消息
await bot.callApi('send_group_msg', {
  group_id: 123456,
  message: '消息内容'
})

// 发送私聊消息
await bot.callApi('send_private_msg', {
  user_id: 123456,
  message: '消息内容'
})

// 撤回消息
await bot.callApi('delete_msg', {
  message_id: 123456
})
```

### 信息获取

```typescript
// 获取登录信息
const loginInfo = await bot.callApi('get_login_info')

// 获取用户信息
const userInfo = await bot.callApi('get_stranger_info', {
  user_id: 123456
})

// 获取群信息
const groupInfo = await bot.callApi('get_group_info', {
  group_id: 123456
})

// 获取群成员列表
const memberList = await bot.callApi('get_group_member_list', {
  group_id: 123456
})
```

### 群管理

```typescript
// 踢出群成员
await bot.callApi('set_group_kick', {
  group_id: 123456,
  user_id: 654321
})

// 禁言群成员
await bot.callApi('set_group_ban', {
  group_id: 123456,
  user_id: 654321,
  duration: 600 // 秒
})

// 设置群名片
await bot.callApi('set_group_card', {
  group_id: 123456,
  user_id: 654321,
  card: '新名片'
})
```

## 连接模式对比

### 正向 WebSocket（客户端模式）

**优点：**
- ✅ 配置简单
- ✅ 主动连接，无需开放端口
- ✅ 适合本地开发

**缺点：**
- ❌ 需要 OneBot 实现提供 WebSocket 服务

### 反向 WebSocket（服务器模式）

**优点：**
- ✅ OneBot 实现主动连接
- ✅ 支持多个客户端连接
- ✅ 适合生产环境

**缺点：**
- ❌ 需要开放端口或使用内网穿透
- ❌ 配置相对复杂

## 消息 ID 格式

OneBot11 适配器的消息 ID 格式：`{message_id}`

撤回消息时直接使用数字 ID。

## 注意事项

### Access Token

建议配置 Access Token 增强安全性：
```typescript
{
  access_token: process.env.ONEBOT_TOKEN
}
```

OneBot 实现需要配置相同的 Token。

### 重连机制

适配器会自动重连，可配置重连间隔：
```typescript
{
  reconnect_interval: 5000  // 5秒后重连
}
```

### 心跳检测

心跳机制确保连接活跃：
```typescript
{
  heartbeat_interval: 30000  // 30秒发送一次心跳
}
```

### API 超时

API 调用默认 30 秒超时，可在代码中调整。

## 常见问题

### Q: 连接不上 OneBot 服务？

A: 检查：
1. OneBot 服务是否启动
2. WebSocket 地址是否正确
3. Access Token 是否匹配
4. 防火墙是否阻止连接

### Q: 消息发送失败？

A: 可能原因：
1. 未登录或登录失败
2. 被风控限制
3. 群/好友不存在
4. 消息格式错误

### Q: 反向 WS 无法连接？

A: 确认：
1. HTTP 服务已启动
2. WebSocket 路径配置正确
3. OneBot 配置的反向 WS 地址正确
4. 端口已开放

### Q: 如何处理 CQ 码？

A: OneBot11 适配器自动处理 CQ 码转换，使用消息段格式即可：
```typescript
[
  { type: 'text', data: { text: '文本' } },
  { type: 'image', data: { file: 'url' } }
]
```

## 相关链接

- [OneBot 标准](https://github.com/botuniverse/onebot-11)
- [go-cqhttp](https://github.com/Mrs4s/go-cqhttp)
- [LagrangeGo](https://github.com/LagrangeDev/Lagrange.Core)
- [Shamrock](https://github.com/whitechi73/OpenShamrock)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)

## 依赖项

- `ws` - WebSocket 客户端/服务器库
- `zhin.js` - Zhin 核心框架

## 开发

```bash
pnpm build  # 构建
pnpm clean  # 清理构建文件
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
