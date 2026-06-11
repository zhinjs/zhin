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

## 前置条件

| 要求 | 说明 |
|------|------|
| **邮箱账号** | 可用的 SMTP 发信与 IMAP 收信账号（或同一邮箱双协议） |
| **应用专用密码** | Gmail、Outlook 等常需开启「第三方应用访问」或生成应用密码 |
| **网络** | 出站可连 SMTP/IMAP 端口（465/587/993 等） |
| **host-router** | 不需要；IMAP 轮询在适配器内完成 |

必填字段见 `EmailEndpointConfig`：`context`、`name`、`smtp`、`imap`（含 `auth.user` / `auth.pass` 与 `user` / `password`）。

## 最小配置

```yaml
plugins:
  - "@zhin.js/adapter-email"

endpoints:
  - context: email
    name: my-email-bot
    smtp:
      host: smtp.example.com
      port: 465
      secure: true
      auth:
        user: bot@example.com
        pass: "${EMAIL_PASSWORD}"
    imap:
      host: imap.example.com
      port: 993
      tls: true
      user: bot@example.com
      password: "${EMAIL_PASSWORD}"
```

## 配置

### 可选 IMAP 字段

```yaml
    imap:
      host: imap.example.com
      port: 993
      tls: true
      user: bot@example.com
      password: "${EMAIL_PASSWORD}"
      # checkInterval: 30000     # 轮询间隔（毫秒），默认 30 秒
      # mailbox: INBOX           # 监听的邮箱文件夹
      # markSeen: true           # 已读标记
```

### TypeScript 配置

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  endpoints: [
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
  plugins: ['@zhin.js/adapter-email']
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
    .action(() => 'Agent 运行中')
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

## 故障排查

| 现象 | 排查 |
|------|------|
| IMAP 连接失败 | 主机/端口/TLS 是否正确；是否需应用专用密码而非登录密码 |
| 收不到新邮件 | 默认轮询间隔 30s（`checkInterval`）；检查 `mailbox` 是否为 `INBOX` |
| SMTP 发送失败 | `secure` 与端口匹配（465 通常 `secure: true`）；发信地址与 `auth.user` 一致 |
| 重复处理邮件 | 确认 `markSeen: true`；检查是否多实例同时轮询同一邮箱 |

建议使用环境变量存储邮箱密码，勿提交到版本库。

## 文档链接

- [Email 适配器文档](https://zhin.js.org/adapters/email)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
