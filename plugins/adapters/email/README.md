# @zhin.js/adapter-email

Zhin.js 邮件适配器，通过 SMTP 发送和 IMAP 接收邮件，将邮箱作为聊天平台接入。

## 功能特性

- SMTP 邮件发送（基于 nodemailer）
- IMAP 邮件接收（基于 imap + mailparser）
- 支持附件处理
- 定时轮询新邮件
- TLS/SSL 加密连接

## 安装

```bash
pnpm add @zhin.js/adapter-email
```

## 配置

```yaml
# zhin.config.yml
bots:
  - context: email
    name: my-email-bot
    smtp:
      host: smtp.example.com
      port: 465
      secure: true
      auth:
        user: bot@example.com
        pass: ${EMAIL_PASSWORD}
    imap:
      host: imap.example.com
      port: 993
      tls: true
      user: bot@example.com
      password: ${EMAIL_PASSWORD}
      # checkInterval: 30000     # 轮询间隔（毫秒），默认 30 秒
      # mailbox: INBOX           # 监听的邮箱文件夹
      # markSeen: true           # 已读标记

plugins:
  - adapter-email
```

### TypeScript 配置

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'email',
      name: 'my-email-bot',
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: {
          user: 'bot@example.com',
          pass: process.env.EMAIL_PASSWORD!,
        },
      },
      imap: {
        host: 'imap.example.com',
        port: 993,
        tls: true,
        user: 'bot@example.com',
        password: process.env.EMAIL_PASSWORD!,
      },
    }
  ],
  plugins: ['adapter-email']
})
```

## 使用示例

### 注册命令

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('status')
    .desc('查询状态')
    .action(() => '机器人运行中')
)
```

### 消息处理

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  if (message.$adapter === 'email') {
    console.log('收到邮件:', message.$sender.name, message.$content)
  }
  await next()
})
```

## 注意事项

- IMAP 接收使用轮询机制，`checkInterval` 控制轮询频率
- 部分邮箱服务商需要开启"第三方应用访问"或"应用专用密码"
- 建议使用环境变量存储邮箱密码

## 许可证

MIT License
