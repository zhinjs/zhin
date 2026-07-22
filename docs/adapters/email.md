---
title: "@zhin.js/adapter-email"
package: "@zhin.js/adapter-email"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/email/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/email/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=75b5de0301a147f8 -->

# @zhin.js/adapter-email

Zhin.js 邮件适配器（Plugin Runtime），通过 SMTP 发送和 IMAP 接收邮件，将邮箱作为聊天通道接入。

## 功能特性

- SMTP 邮件发送（基于 nodemailer）
- IMAP 邮件接收（基于 imap + mailparser）
- 定时轮询未读邮件
- TLS/SSL 加密连接
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-email
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/email.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`（`smtp` / `imap`）

入站：`gateway.receive({ adapter, target: fromEmail, content: text, sender, metadata })`  
出站：`send({ target, payload })` → nodemailer（payload 已由 gateway/core 渲染；无 segment-mapper）

## 前置条件

| 要求 | 说明 |
|------|------|
| **邮箱账号** | 可用的 SMTP 发信与 IMAP 收信账号 |
| **应用专用密码** | Gmail、Outlook 等常需应用密码 |
| **网络** | 出站可连 SMTP/IMAP 端口（465/587/993 等） |
| **host-http** | 不需要；IMAP 轮询在适配器内完成 |

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  email:
    endpoints:
      - name: my-email-bot
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

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-email`（`instanceKey: email`）。

### 可选 IMAP 字段

- `checkInterval`：轮询间隔（毫秒），默认 `60000`
- `mailbox`：默认 `INBOX`
- `markSeen`：默认 `true`

### 附件下载

`attachments.enabled: true` 时，入站邮件附件会落盘并把保存信息写入消息 metadata（`attachments: [{ filename, path, contentType, size }]`）：

- `downloadPath`：保存目录，默认 `./downloads/email`
- `maxFileSize`：单附件上限（字节），默认 10MB，超限跳过
- `allowedTypes`：允许的 MIME 类型白名单，不在列表内跳过

## 故障排查

| 现象 | 排查 |
|------|------|
| IMAP 连接失败 | 主机/端口/TLS；是否需应用专用密码 |
| 收不到新邮件 | `checkInterval` / `mailbox`；确认 `open()` 后才准入入站 |
| SMTP 发送失败 | `secure` 与端口匹配；发信地址与 `auth.user` 一致 |
| 重复处理邮件 | `markSeen: true`；避免多实例轮询同一邮箱 |

建议使用环境变量存储邮箱密码，勿提交到版本库。

## AI 工具

技能说明见 `agent/skills/email.md`。

## 文档链接

- [Email 适配器文档](https://zhin.js.org/adapters/email)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
