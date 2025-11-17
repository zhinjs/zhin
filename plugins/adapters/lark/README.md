# @zhin.js/adapter-lark

Zhin.js 飞书/Lark 适配器，支持飞书（中国版）和 Lark（国际版）机器人开发。

## 安装

```bash
pnpm add @zhin.js/adapter-lark
```

## 配置

### 基础配置

```typescript
import { LarkBotConfig } from '@zhin.js/adapter-lark';

const config: LarkBotConfig = {
  context: 'lark',
  name: 'my-lark-bot',
  appId: 'YOUR_APP_ID',           // 飞书应用 ID
  appSecret: 'YOUR_APP_SECRET',   // 飞书应用密钥
  webhookPath: '/lark/webhook',   // Webhook 路径
}
```

### 完整配置

```typescript
const config: LarkBotConfig = {
  context: 'lark',
  name: 'my-lark-bot',
  appId: 'YOUR_APP_ID',
  appSecret: 'YOUR_APP_SECRET',
  webhookPath: '/lark/webhook',
  
  // 安全配置（推荐）
  encryptKey: 'YOUR_ENCRYPT_KEY',           // 事件推送加密密钥
  verificationToken: 'YOUR_VERIFICATION_TOKEN', // 事件推送验证令牌
  
  // API 配置
  isFeishu: true,  // true=飞书(中国版), false=Lark(国际版), 默认false
  apiBaseUrl: 'https://open.feishu.cn/open-apis' // 自定义API地址（可选）
}
```

### 配置参数说明

- `appId` (必需): 飞书应用 ID，在开发者后台获取
- `appSecret` (必需): 飞书应用密钥，在开发者后台获取
- `webhookPath` (必需): Webhook 路径，如 `/lark/webhook`
- `encryptKey` (推荐): 事件推送加密密钥，用于签名验证
- `verificationToken` (推荐): 事件推送验证令牌，额外安全验证
- `isFeishu` (可选): 是否为飞书中国版，默认 `false` (Lark 国际版)
- `apiBaseUrl` (可选): 自定义 API 基础地址

## 获取配置信息

### 创建飞书/Lark 应用

#### 飞书（中国版）
1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建应用」，选择「自建应用」
3. 填写应用信息并创建

#### Lark（国际版）
1. 访问 [Lark Developer Console](https://open.larksuite.com/app)
2. 点击「Create App」，选择「Custom App」
3. 填写应用信息并创建

### 获取应用凭证

在应用详情页面的「凭证与基础信息」中获取：
- **App ID**: 应用唯一标识
- **App Secret**: 应用密钥（注意保密）

### 配置机器人

1. **启用机器人功能**：
   - 在应用管理页面，进入「功能配置」→「机器人」
   - 启用机器人功能

2. **配置事件订阅**：
   - 进入「事件订阅」页面
   - 设置请求网址：`https://yourdomain.com/lark/webhook`
   - 配置加密策略（推荐启用）
   - 订阅需要的事件类型：
     - `接收消息` - 接收用户发送的消息
     - `消息已读` - 消息已读事件
     - 其他所需事件

3. **配置权限**：
   - 在「权限管理」中申请所需权限：
     - `以应用的身份发消息` - 发送消息
     - `获取与发送单聊、群组消息` - 收发消息
     - `读取用户通讯录基本信息` - 获取用户信息
     - 其他业务需要的权限

4. **发布应用**：
   - 完成配置后，提交审核并发布应用

## 使用示例

### 基础使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-lark';
import '@zhin.js/http'; // 需要 HTTP 插件支持

const app = createApp();

// 先加载 HTTP 插件
app.plugin(require('@zhin.js/http'));

// 配置飞书适配器
app.adapter('lark', {
  context: 'lark',
  name: 'my-bot',
  appId: process.env.LARK_APP_ID!,
  appSecret: process.env.LARK_APP_SECRET!,
  webhookPath: '/lark/webhook',
  encryptKey: process.env.LARK_ENCRYPT_KEY,
  verificationToken: process.env.LARK_VERIFICATION_TOKEN,
  isFeishu: true // 使用飞书中国版
});

// 基础命令
app.command('ping').action((session) => {
  session.send('pong! 🏓');
});

// 处理用户消息
app.middleware((session, next) => {
  console.log(`收到来自 ${session.$sender.name} 的消息`);
  return next();
});

app.start();
```

### 高级功能使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-lark';

const app = createApp();

app.plugin(require('@zhin.js/http'));

const bot = app.adapter('lark', {
  context: 'lark',
  name: 'advanced-bot',
  appId: process.env.LARK_APP_ID!,
  appSecret: process.env.LARK_APP_SECRET!,
  webhookPath: '/lark/webhook',
  encryptKey: process.env.LARK_ENCRYPT_KEY,
  isFeishu: true
});

// 帮助命令
app.command('help').action(async (session) => {
  await session.send([
    { type: 'text', data: { content: '🤖 机器人帮助\\n\\n' } },
    { type: 'text', data: { content: '📝 /help - 显示此帮助\\n' } },
    { type: 'text', data: { content: '🏓 /ping - 测试连通性\\n' } },
    { type: 'text', data: { content: '👤 /me - 查看个人信息\\n' } },
    { type: 'text', data: { content: '📊 /stats - 查看统计信息' } }
  ]);
});

// 个人信息查询
app.command('me').action(async (session) => {
  const userInfo = await bot.getUserInfo(session.$sender.id);
  if (userInfo) {
    await session.send(`👤 用户信息:\\n姓名: ${userInfo.name}\\n邮箱: ${userInfo.email || '未设置'}`);
  } else {
    await session.send('❌ 无法获取用户信息');
  }
});

// 处理 @提及
app.middleware((session, next) => {
  const mentions = session.content.filter(seg => seg.type === 'at');
  if (mentions.length > 0) {
    console.log('收到提及:', mentions.map(m => m.data.name));
    session.send(`👋 我看到你提及了 ${mentions.length} 个用户`);
  }
  return next();
});

// 处理图片消息
app.middleware((session, next) => {
  const images = session.content.filter(seg => seg.type === 'image');
  if (images.length > 0) {
    session.send(`📷 收到了 ${images.length} 张图片！`);
  }
  return next();
});

// 处理文件消息
app.middleware((session, next) => {
  const files = session.content.filter(seg => seg.type === 'file');
  if (files.length > 0) {
    const fileNames = files.map(f => f.data.file_name).join(', ');
    session.send(`📎 收到文件: ${fileNames}`);
  }
  return next();
});

// 发送卡片消息
app.command('card').action(async (session) => {
  await session.send([
    {
      type: 'card',
      data: {
        config: {
          wide_screen_mode: true
        },
        elements: [
          {
            tag: 'div',
            text: {
              content: '**这是一个交互式卡片**\\n\\n点击下方按钮体验功能',
              tag: 'lark_md'
            }
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: {
                  content: '点赞 👍',
                  tag: 'plain_text'
                },
                type: 'primary',
                value: {
                  action: 'like'
                }
              },
              {
                tag: 'button',
                text: {
                  content: '查看详情',
                  tag: 'plain_text'
                },
                type: 'default',
                value: {
                  action: 'detail'
                }
              }
            ]
          }
        ],
        header: {
          title: {
            content: '🎉 欢迎使用飞书机器人',
            tag: 'plain_text'
          },
          template: 'blue'
        }
      }
    }
  ]);
});

app.start();
```

### 文件上传示例

```typescript
// 上传并发送图片
app.command('upload-image').action(async (session) => {
  try {
    const fileKey = await bot.uploadFile('./path/to/image.jpg', 'image');
    if (fileKey) {
      await session.send([
        { type: 'image', data: { file_key: fileKey } }
      ]);
    }
  } catch (error) {
    await session.send('❌ 文件上传失败');
  }
});

// 上传并发送文件
app.command('upload-file').action(async (session) => {
  try {
    const fileKey = await bot.uploadFile('./path/to/document.pdf', 'file');
    if (fileKey) {
      await session.send([
        { type: 'file', data: { file_key: fileKey } }
      ]);
    }
  } catch (error) {
    await session.send('❌ 文件上传失败');
  }
});
```

## 支持的消息类型

### 接收消息类型

- **文本消息**: 支持纯文本和富文本格式
- **图片消息**: 支持各种格式的图片
- **文件消息**: 支持各种类型的文件附件
- **音频消息**: 支持语音和音频文件
- **视频消息**: 支持视频文件
- **贴纸消息**: 支持飞书表情包
- **卡片消息**: 支持交互式卡片和富文本卡片
- **@提及**: 支持用户提及解析
- **链接消息**: 自动解析文本中的链接
- **富文本**: 支持格式化文本内容

### 发送消息类型

- **文本消息**: 发送纯文本内容
- **图片消息**: 发送图片（需要先上传获取 file_key）
- **文件消息**: 发送文件（需要先上传获取 file_key）
- **卡片消息**: 发送交互式卡片和富文本卡片
- **@提及**: 在消息中提及特定用户
- **链接消息**: 发送包含链接的富文本

## 聊天类型支持

- `private`: 私聊（单聊）
- `group`: 群聊

## 飞书特色功能

### 交互式卡片

飞书支持丰富的交互式卡片，可以创建按钮、表单、图表等：

```typescript
app.command('interactive-card').action(async (session) => {
  await session.send([
    {
      type: 'card',
      data: {
        config: {
          wide_screen_mode: true
        },
        elements: [
          // 文本内容
          {
            tag: 'div',
            text: {
              content: '请选择您的偏好设置：',
              tag: 'plain_text'
            }
          },
          // 分割线
          {
            tag: 'hr'
          },
          // 选择器
          {
            tag: 'div',
            fields: [
              {
                is_short: true,
                text: {
                  content: '**语言偏好**\\nChinese',
                  tag: 'lark_md'
                }
              },
              {
                is_short: true,
                text: {
                  content: '**通知设置**\\n开启',
                  tag: 'lark_md'
                }
              }
            ]
          },
          // 按钮组
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: {
                  content: '保存设置',
                  tag: 'plain_text'
                },
                type: 'primary',
                value: {
                  action: 'save_settings'
                }
              },
              {
                tag: 'button',
                text: {
                  content: '重置',
                  tag: 'plain_text'
                },
                type: 'danger',
                value: {
                  action: 'reset'
                }
              }
            ]
          }
        ],
        header: {
          title: {
            content: '⚙️ 设置面板',
            tag: 'plain_text'
          },
          template: 'green'
        }
      }
    }
  ]);
});
```

### 文件操作

飞书支持多种文件操作：

```typescript
// 获取文件信息
app.command('file-info <file_key>').action(async (session) => {
  const fileKey = session.argv.file_key;
  
  try {
    const response = await bot.axiosInstance.get(\`/im/v1/files/\${fileKey}\`);
    const fileInfo = response.data.data;
    
    await session.send(\`📄 文件信息：\\n文件名: \${fileInfo.file_name}\\n大小: \${fileInfo.file_size} bytes\\n类型: \${fileInfo.file_type}\`);
  } catch (error) {
    await session.send('❌ 获取文件信息失败');
  }
});

// 下载文件
app.command('download <file_key>').action(async (session) => {
  const fileKey = session.argv.file_key;
  
  try {
    const response = await bot.axiosInstance.get(\`/im/v1/files/\${fileKey}/download\`);
    // 处理文件下载逻辑
    await session.send('✅ 文件下载完成');
  } catch (error) {
    await session.send('❌ 文件下载失败');
  }
});
```

### 用户和群组管理

```typescript
// 获取群组成员列表
app.command('members').action(async (session) => {
  if (session.$channel.type !== 'group') {
    await session.send('❌ 此命令只能在群聊中使用');
    return;
  }
  
  try {
    const chatInfo = await bot.getChatInfo(session.$channel.id);
    const memberCount = chatInfo?.member_count || 0;
    
    await session.send(\`👥 群组信息：\\n群名称: \${chatInfo?.name || '未知'}\\n成员数量: \${memberCount}\`);
  } catch (error) {
    await session.send('❌ 获取群组信息失败');
  }
});

// 获取用户详细信息
app.command('user-info [user_id]').action(async (session) => {
  const userId = session.argv.user_id || session.$sender.id;
  
  try {
    const userInfo = await bot.getUserInfo(userId);
    if (userInfo) {
      await session.send([
        { type: 'text', data: { content: \`👤 用户详情：\\n\` } },
        { type: 'text', data: { content: \`姓名: \${userInfo.name}\\n\` } },
        { type: 'text', data: { content: \`邮箱: \${userInfo.email || '未设置'}\\n\` } },
        { type: 'text', data: { content: \`部门: \${userInfo.department_ids?.join(', ') || '未知'}\` } }
      ]);
    }
  } catch (error) {
    await session.send('❌ 获取用户信息失败');
  }
});
```

## 最佳实践

### 1. 安全配置

```typescript
// 生产环境建议启用所有安全选项
const config: LarkBotConfig = {
  context: 'lark',
  name: 'production-bot',
  appId: process.env.LARK_APP_ID!,
  appSecret: process.env.LARK_APP_SECRET!,
  webhookPath: '/lark/webhook',
  
  // 必须配置的安全选项
  encryptKey: process.env.LARK_ENCRYPT_KEY!,
  verificationToken: process.env.LARK_VERIFICATION_TOKEN!,
  
  isFeishu: true
};
```

### 2. 错误处理

```typescript
// 全局错误处理
app.middleware(async (session, next) => {
  try {
    await next();
  } catch (error) {
    console.error('Command execution error:', error);
    await session.send('❌ 命令执行出错，请稍后重试');
  }
});

// API 调用错误处理
app.command('safe-api').action(async (session) => {
  try {
    const userInfo = await bot.getUserInfo(session.$sender.id);
    // 处理成功逻辑
  } catch (error) {
    if (error.response?.status === 403) {
      await session.send('❌ 权限不足，请联系管理员');
    } else if (error.response?.status === 429) {
      await session.send('❌ 请求频率过高，请稍后重试');
    } else {
      await session.send('❌ 服务暂时不可用');
    }
  }
});
```

### 3. 性能优化

```typescript
// 缓存 access_token（已在适配器内部实现）
// 批量处理消息
const messageQueue: string[] = [];

app.middleware((session, next) => {
  // 简单的消息队列示例
  messageQueue.push(session.$content.map(s => s.data?.content || '').join(''));
  
  // 每10条消息批量处理一次
  if (messageQueue.length >= 10) {
    console.log('Processing batch messages:', messageQueue.length);
    messageQueue.length = 0; // 清空队列
  }
  
  return next();
});
```

## 故障排除

### 常见问题

1. **Webhook 验证失败**
   ```
   Invalid verification token in webhook
   ```
   - 检查 `verificationToken` 配置是否正确
   - 确认飞书后台的验证令牌设置

2. **签名验证失败**
   ```
   Invalid signature in webhook
   ```
   - 检查 `encryptKey` 配置是否正确
   - 确认飞书后台的加密设置

3. **Token 获取失败**
   ```
   Failed to get access token
   ```
   - 检查 `appId` 和 `appSecret` 是否正确
   - 确认应用是否已发布且状态正常
   - 检查网络连接和 API 地址

4. **消息发送失败**
   ```
   Failed to send message: no permission
   ```
   - 检查应用权限配置
   - 确认机器人是否在目标群组中
   - 验证用户是否允许机器人发消息

5. **文件上传失败**
   ```
   Upload failed: file too large
   ```
   - 检查文件大小是否超出限制
   - 确认文件格式是否支持
   - 检查应用是否有文件上传权限

### 调试技巧

1. **启用详细日志**：
   ```typescript
   // 在配置中启用调试模式
   app.plugin(require('@zhin.js/logger'), {
     level: 'debug'
   });
   ```

2. **查看原始事件数据**：
   ```typescript
   app.middleware((session, next) => {
     console.log('Raw event:', session.$raw);
     return next();
   });
   ```

3. **测试 Webhook 连通性**：
   使用工具如 ngrok 在本地测试 Webhook 接收

## 注意事项

1. **应用权限**: 确保在飞书开发者后台配置了正确的权限
2. **网络环境**: 飞书和 Lark 使用不同的 API 域名，确保网络能正常访问
3. **消息限制**: 注意飞书的消息发送频率限制
4. **文件大小**: 文件上传有大小限制，通常为 30MB
5. **安全配置**: 生产环境强烈建议启用签名验证和令牌验证
6. **应用审核**: 某些功能可能需要应用通过审核才能使用

## 更新日志

### v1.0.0
- 🎉 初始版本发布
- 🔐 完整的安全验证机制
- 📱 支持飞书和 Lark 双平台
- 💬 丰富的消息类型支持
- 🎛️ 交互式卡片支持
- 📁 文件上传下载功能
- 👥 用户和群组管理
- 🚀 使用 `useContext('router')` 集成 HTTP 服务
- ⚡ 自动 token 管理和刷新
