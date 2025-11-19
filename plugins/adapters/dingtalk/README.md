# @zhin.js/adapter-dingtalk

Zhin.js 钉钉适配器，支持企业内部机器人和钉钉开放平台机器人开发。

## 安装

```bash
pnpm add @zhin.js/adapter-dingtalk
```

## 配置

### 基础配置

```typescript
import { DingTalkBotConfig } from '@zhin.js/adapter-dingtalk';

const config: DingTalkBotConfig = {
  context: 'dingtalk',
  name: 'my-dingtalk-bot',
  appKey: 'YOUR_APP_KEY',           // 钉钉应用 AppKey
  appSecret: 'YOUR_APP_SECRET',     // 钉钉应用 AppSecret
  webhookPath: '/dingtalk/webhook', // Webhook 路径
  robotCode: 'YOUR_ROBOT_CODE'      // 机器人编码（可选）
}
```

### 完整配置

```typescript
const config: DingTalkBotConfig = {
  context: 'dingtalk',
  name: 'my-dingtalk-bot',
  appKey: 'YOUR_APP_KEY',
  appSecret: 'YOUR_APP_SECRET',
  webhookPath: '/dingtalk/webhook',
  robotCode: 'YOUR_ROBOT_CODE',
  
  // API 配置
  apiBaseUrl: 'https://oapi.dingtalk.com' // 自定义API地址（可选）
}
```

### 配置参数说明

- `appKey` (必需): 钉钉应用的 AppKey，在开发者后台获取
- `appSecret` (必需): 钉钉应用的 AppSecret，在开发者后台获取
- `webhookPath` (必需): Webhook 路径，如 `/dingtalk/webhook`
- `robotCode` (可选): 机器人编码，用于发送消息时识别机器人身份
- `apiBaseUrl` (可选): 自定义 API 基础地址，默认为 `https://oapi.dingtalk.com`

## 获取配置信息

### 创建钉钉企业内部应用

1. **访问钉钉开放平台**
   - 登录 [钉钉开放平台](https://open.dingtalk.com/)
   - 进入「应用开发」→「企业内部开发」

2. **创建应用**
   - 点击「创建应用」
   - 选择「企业内部开发」→「机器人」
   - 填写应用基本信息（应用名称、应用描述、应用图标等）

3. **获取应用凭证**
   - 在应用详情页面找到「开发管理」
   - 获取 **AppKey** 和 **AppSecret**
   - 记录这些信息用于配置

### 配置机器人

1. **配置机器人能力**
   - 在应用详情页面，进入「机器人配置」
   - 启用「消息接收」功能
   - 获取机器人的 **RobotCode**（机器人编码）

2. **配置消息接收地址**
   - 在「消息接收」设置中配置接收地址
   - 设置请求 URL：`https://yourdomain.com/dingtalk/webhook`
   - 钉钉会通过该地址推送消息事件

3. **配置权限**
   - 在「权限管理」中申请所需权限：
     - `通讯录只读权限` - 读取通讯录信息
     - `企业通讯录个人信息读权限` - 获取用户详细信息
     - `消息通知` - 发送工作通知
     - 其他业务需要的权限

4. **发布应用**
   - 完成配置后，发布应用
   - 在企业工作台添加应用
   - 员工可在钉钉中找到并使用该机器人

### 创建群机器人（Webhook 机器人）

如果只需要简单的群聊机器人功能：

1. **在群聊中添加机器人**
   - 进入钉钉群聊
   - 点击群设置 → 「智能群助手」
   - 选择「添加机器人」→「自定义机器人」

2. **配置 Webhook**
   - 输入机器人名称
   - 获取 Webhook 地址
   - 配置安全设置（加签或关键词）

3. **使用限制**
   - 群机器人只能在对应群聊中使用
   - 功能相对简单，适合轻量级场景

## 使用示例

### 配置文件（zhin.config.ts）

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'dingtalk-bot',
      context: 'dingtalk',
      appKey: 'dingxxxxxxxxxx',
      appSecret: 'your-app-secret',
      webhookPath: '/dingtalk/webhook',
      robotCode: 'dingxxxxxxxxxxxxxxxx'
    }
  ],
  plugins: [
    'http',              // HTTP 服务（必需，提供 webhook 接口）
    'adapter-dingtalk',  // 钉钉适配器
    // 其他插件...
  ]
})
```

### 接收和发送消息

```typescript
import { addCommand, MessageCommand, useLogger } from 'zhin.js'

const logger = useLogger()

// 定义命令
addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    logger.info(`收到来自 ${result.params.name} 的问候`)
    return `你好，${result.params.name}！欢迎使用钉钉机器人。`
  })
)

// 监听所有消息
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  logger.info(`收到消息：${message.$raw}`)
  logger.info(`发送者：${message.$sender.name}`)
  logger.info(`会话类型：${message.$channel.type}`)
})
```

### 使用 @ 功能

```typescript
addCommand(new MessageCommand('notify <...users:at>')
  .action(async (message, result) => {
    const users = result.params.users
    return [
      { type: 'text', data: { content: '通知以下用户：\n' } },
      ...users.map(user => ({ 
        type: 'at', 
        data: { id: user.data.id, name: user.data.name } 
      })),
      { type: 'text', data: { content: '\n请注意查看！' } }
    ]
  })
)
```

### 发送富文本消息

```typescript
addCommand(new MessageCommand('info')
  .action(async (message) => {
    return [
      {
        type: 'markdown',
        data: {
          title: '系统信息',
          content: `
# 系统信息

## 基本信息
- **服务器**: 运行正常
- **版本**: v1.0.0
- **状态**: ✅ 在线

## 功能列表
1. 消息接收与发送
2. 命令解析
3. @ 提醒功能
          `
        }
      }
    ]
  })
)
```

## 消息类型支持

### 接收消息类型

- ✅ **文本消息** (`text`) - 普通文本和 @ 提醒
- ✅ **图片消息** (`picture`) - 图片文件
- ✅ **文件消息** (`file`) - 各类文件
- ✅ **语音消息** (`audio`) - 音频文件
- ✅ **视频消息** (`video`) - 视频文件
- ✅ **富文本消息** (`richText`) - 富文本内容
- ✅ **Markdown 消息** (`markdown`) - Markdown 格式

### 发送消息类型

- ✅ **文本消息** - 支持 @ 提醒
- ✅ **图片消息** - 通过 URL 发送
- ✅ **Markdown 消息** - 富文本展示
- ✅ **链接消息** - 卡片式链接
- ❌ **撤回消息** - 钉钉机器人不支持撤回

## API 方法

### 获取用户信息

```typescript
const bot = app.adapters.get('dingtalk')?.bots.get('dingtalk-bot')
if (bot) {
  const userInfo = await bot.getUserInfo('user-id')
  console.log(userInfo)
}
```

### 获取部门用户列表

```typescript
const users = await bot.getDepartmentUsers(1) // 部门 ID
console.log(users)
```

### 发送工作通知

```typescript
await bot.sendWorkNotice(
  ['user1', 'user2'], // 用户 ID 列表
  {
    msgtype: 'text',
    text: { content: '这是一条工作通知' }
  }
)
```

## 安全说明

### 签名验证

钉钉会在 Webhook 请求的 Header 中携带签名信息：
- `timestamp`: 时间戳
- `sign`: 签名值

适配器会自动验证签名，确保请求来自钉钉服务器。

### Token 管理

适配器会自动管理 access_token：
- 首次连接时获取 token
- Token 过期前 5 分钟自动刷新
- 所有 API 请求自动携带有效 token

## 最佳实践

### 1. 配置环境变量

不要在代码中硬编码敏感信息：

```typescript
export default defineConfig({
  bots: [{
    name: 'dingtalk-bot',
    context: 'dingtalk',
    appKey: process.env.DINGTALK_APP_KEY!,
    appSecret: process.env.DINGTALK_APP_SECRET!,
    webhookPath: '/dingtalk/webhook',
    robotCode: process.env.DINGTALK_ROBOT_CODE
  }]
})
```

### 2. 错误处理

处理可能的错误情况：

```typescript
onMessage(async (message) => {
  try {
    // 处理消息逻辑
  } catch (error) {
    logger.error('处理消息失败:', error)
    await message.$reply('抱歉，处理消息时出现错误')
  }
})
```

### 3. 消息限流

注意钉钉的 API 调用频率限制，避免过于频繁的请求。

### 4. 日志记录

开启详细日志，便于排查问题：

```typescript
export default defineConfig({
  log_level: 'debug', // 开发环境使用 debug
  // ... 其他配置
})
```

## 常见问题

### Q: Webhook 收不到消息？

A: 检查以下几点：
1. Webhook URL 是否可以从公网访问
2. 钉钉后台的消息接收地址是否配置正确
3. 应用是否已经发布并添加到工作台
4. 检查服务器日志是否有错误信息

### Q: 发送消息失败？

A: 可能的原因：
1. AppKey 或 AppSecret 配置错误
2. access_token 获取失败
3. 机器人编码（robotCode）配置错误
4. 网络问题或 API 限流

### Q: @ 功能不生效？

A: 确保：
1. 使用正确的用户 ID 格式
2. @ 的用户在当前会话中
3. 消息格式正确包含 at 字段

## 相关链接

- [钉钉开放平台](https://open.dingtalk.com/)
- [钉钉机器人开发文档](https://open.dingtalk.com/document/robots/robot-overview)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
