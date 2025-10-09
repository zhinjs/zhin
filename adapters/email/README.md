# Email 适配器

基于 SMTP/IMAP 协议的邮件适配器，支持邮件的收发、附件处理等功能。

## 安装

```bash
pnpm add @zhin.js/adapter-email
```

## 依赖库

本适配器使用以下库：
- `nodemailer` - SMTP 邮件发送
- `imap` - IMAP 邮件接收
- `mailparser` - 邮件内容解析

## 配置

### 基础配置

```typescript
import { EmailBotConfig } from '@zhin.js/adapter-email'

const emailConfig: EmailBotConfig = {
  context: 'email',
  name: 'my-email-bot',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'
    }
  },
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    user: 'your-email@gmail.com',
    password: 'your-app-password',
    checkInterval: 60000, // 检查新邮件间隔（毫秒）
    mailbox: 'INBOX', // 监听的邮箱文件夹
    markSeen: true // 是否标记已读
  }
}
```

### 完整配置选项

```typescript
const fullEmailConfig: EmailBotConfig = {
  context: 'email',
  name: 'advanced-email-bot',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'
    }
  },
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    user: 'your-email@gmail.com',
    password: 'your-app-password',
    checkInterval: 30000, // 30秒检查一次
    mailbox: 'INBOX',
    markSeen: true
  },
  attachments: {
    enabled: true,
    downloadPath: './downloads/email', // 附件下载路径
    maxFileSize: 10 * 1024 * 1024, // 10MB 最大文件大小
    allowedTypes: ['image/*', 'text/*', 'application/pdf'] // 允许的文件类型
  }
}
```

## 使用示例

### 基础使用

```typescript
import { createApp } from 'zhin.js'
import EmailAdapter from '@zhin.js/adapter-email'

const app = createApp({
  adapters: {
    email: {
      context: 'email',
      name: 'email-bot',
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'your-email@gmail.com',
          pass: 'your-app-password'
        }
      },
      imap: {
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        user: 'your-email@gmail.com',
        password: 'your-app-password'
      }
    }
  }
})

// 处理接收到的邮件
app.on('message.receive', (message) => {
  if (message.$adapter === 'email') {
    console.log('收到邮件:', message.$content)
    
    // 回复邮件
    message.$reply('感谢您的邮件！')
  }
})

app.start()
```

### 发送邮件

```typescript
// 发送简单文本邮件
await app.sendMessage({
  adapter: 'email',
  channel_id: 'recipient@example.com',
  content: '这是一条测试邮件'
})

// 发送带附件的邮件
await app.sendMessage({
  adapter: 'email',
  channel_id: 'recipient@example.com',
  content: [
    { type: 'text', data: { content: '请查收附件' } },
    { type: 'file', data: { url: '/path/to/file.pdf', filename: 'report.pdf' } }
  ]
})
```

### 处理特定邮件

```typescript
app.addCommand('auto-reply', {
  match: (message) => {
    return message.$adapter === 'email' && 
           message.$content.some(seg => seg.type === 'text' && 
           seg.data.content.includes('自动回复'))
  },
  action: async (message) => {
    await message.$reply('这是自动回复邮件。')
  }
})
```

## 邮件服务商配置

### Gmail

1. 开启两步验证
2. 生成应用专用密码
3. 使用以下配置：

```typescript
{
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false
  },
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    tls: true
  }
}
```

### Outlook/Hotmail

```typescript
{
  smtp: {
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false
  },
  imap: {
    host: 'outlook.office365.com',
    port: 993,
    tls: true
  }
}
```

### QQ邮箱

```typescript
{
  smtp: {
    host: 'smtp.qq.com',
    port: 587,
    secure: false
  },
  imap: {
    host: 'imap.qq.com',
    port: 993,
    tls: true
  }
}
```

### 163邮箱

```typescript
{
  smtp: {
    host: 'smtp.163.com',
    port: 465,
    secure: true
  },
  imap: {
    host: 'imap.163.com',
    port: 993,
    tls: true
  }
}
```

## 支持的消息类型

### 接收消息

| 类型 | 说明 | MessageSegment |
|------|------|----------------|
| 文本 | 邮件正文内容 | `text` |
| HTML | HTML格式邮件 | `text` (转换为纯文本) |
| 图片附件 | 图片文件 | `image` |
| 文件附件 | 其他文件 | `file` |
| 主题 | 邮件主题 | `text` (前缀显示) |

### 发送消息

| MessageSegment 类型 | 说明 | 实现方式 |
|-------------------|------|----------|
| `text` | 文本内容 | 作为邮件正文 |
| `image` | 图片 | 作为邮件附件 |
| `file` | 文件 | 作为邮件附件 |

## 频道类型

| 类型 | 说明 | channel_id 格式 |
|------|------|----------------|
| `private` | 个人邮箱 | 邮箱地址 |

注意：邮件适配器只支持 `private` 类型的频道，因为邮件本质上是点对点的通信方式。

## 特性

### ✅ 已实现功能

- **邮件接收**: 基于 IMAP 协议接收新邮件
- **邮件发送**: 基于 SMTP 协议发送邮件
- **附件支持**: 支持接收和发送各种类型的附件
- **定时检查**: 可配置的邮件检查间隔
- **HTML转换**: 自动将HTML邮件转换为纯文本
- **主题解析**: 解析并显示邮件主题
- **回复支持**: 支持回复邮件
- **多邮箱支持**: 支持主流邮箱服务商

### 📋 配置选项

- **SMTP设置**: 完整的SMTP服务器配置
- **IMAP设置**: 完整的IMAP服务器配置
- **附件管理**: 可配置的附件下载和处理
- **检查间隔**: 自定义邮件检查频率
- **邮箱选择**: 指定监听的邮箱文件夹

### 🔧 高级功能

- **邮件过滤**: 只处理未读邮件
- **自动标记**: 可选的已读标记
- **错误处理**: 完整的错误处理和重连机制
- **日志记录**: 详细的操作日志

## 安全注意事项

1. **应用专用密码**: 建议使用应用专用密码而非账户密码
2. **TLS/SSL**: 确保启用加密连接
3. **权限最小化**: 只授予必要的邮箱权限
4. **配置保护**: 不要将邮箱密码硬编码在代码中

## 故障排除

### 连接问题

1. **SMTP连接失败**:
   - 检查服务器地址和端口
   - 确认账户密码正确
   - 检查是否需要应用专用密码

2. **IMAP连接失败**:
   - 确认IMAP服务已启用
   - 检查TLS设置
   - 验证邮箱权限设置

3. **邮件接收异常**:
   - 检查邮箱文件夹名称
   - 确认检查间隔设置
   - 查看错误日志

### 附件问题

1. **附件下载失败**:
   - 检查下载路径权限
   - 验证文件大小限制
   - 确认文件类型允许

2. **附件发送失败**:
   - 检查文件路径是否存在
   - 验证文件大小限制
   - 确认SMTP服务器支持

## 示例项目

完整的使用示例可以在 `test-bot` 目录中找到。

## API 参考

### EmailBot 类

#### 方法

- `$connect()`: 连接邮件服务器
- `$disconnect()`: 断开连接
- `$formatMessage(emailMsg)`: 格式化邮件消息
- `$sendMessage(options)`: 发送邮件

#### 事件

- `message.receive`: 接收到新邮件时触发

### 配置接口

详细的配置接口说明请参考 TypeScript 类型定义。
