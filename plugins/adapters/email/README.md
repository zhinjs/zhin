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

- `@zhin.js/adapter` — 约定式 `adapters/email/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`（`smtp` / `imap`）

入站：`gateway.receive({ conversation, message, content: text, sender, metadata })`（`conversation` 为 kind=private、id=发件人地址的 ConversationRef）  
出站：`send({ conversation, payload })` → nodemailer（收件人取 `conversation.id`；payload 已由 gateway/core 渲染；无 segment-mapper）

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
      - id: my-email-bot
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

技能说明见 `skills/email/SKILL.md`。

## 文档链接

- [Email 适配器文档](https://zhin.js.org/adapters/email)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
# 富文本邮件与适用边界

SMTP 与 IMAP 均支持可选 `serverName`：例如连接 `host: 127.0.0.1` 的 TCP 测试代理时，分别设 `smtp.serverName: smtp.example.com`、`imap.serverName: imap.example.com` 为原始邮件服务域名。它们映射 [Nodemailer `tls.servername`](https://nodemailer.com/smtp) 与 [node-imap `tlsOptions.servername`](https://github.com/mscdex/node-imap)，保留 SNI、证书链及域名校验，不提供关闭证书校验的开关。正常直连无需填写。验收 example 可通过 `EMAIL_SMTP_SERVER_NAME` / `EMAIL_IMAP_SERVER_NAME` 配置，不会自动改写已有环境文件。

canonical `markdown` 保留到 SMTP Endpoint，生成 `text/plain` 与 `text/html` 双正文。支持标题、粗体、斜体、删除线、行内/围栏代码、单层有序/无序列表、引用和 HTTP(S) 链接；原始 HTML 在 Markdown 内按文字转义，不声称完整 CommonMark/GFM 支持。普通文本同样经过 HTML 转义。

canonical `share` 呈现标题链接、说明及纯文本 URL，链接地址保真；平台专属媒体/应用分享元数据明确拒绝。`image` 使用唯一 CID 内联附件，保留文字—图片—文字顺序，纯图片邮件也生成 HTML 正文；URL/path/base64 可用，其他媒体仍作为普通附件。无法解析的媒体及平台不透明文件 ID 在 SMTP 请求前拒绝，避免只发正文却返回成功。

Endpoint 编码函数支持显式 `html` 双正文，但框架统一链路仍将 canonical `html` 渲染成图片或文字；这项直接编码能力不算统一链路的原生 HTML 验收。需要富文本邮件时使用 canonical `markdown`。

Email 没有机器人按钮点击回调传输，`keyboard`/`action` 直接调用 Endpoint 会返回 `unsupported_operation`、`not_sent`。平台能力仍声明 `interactive: text`；验收按钮应标记不适用，不以文本降级或 SMTP messageId 认定可点击交互通过。

本地 MIME 回归使用 nodemailer 的 stream transport 与 mailparser，验证 multipart/related、CID 和解析后的正文/附件；未发送真实邮件，最终显示仍需收件端实机观察。实现遵循 [Nodemailer 内嵌图片](https://nodemailer.com/message/embedded-images) 与 [附件契约](https://nodemailer.com/message/attachments)。

### 入站恢复与去重边界

IMAP 生命周期与重连由 `createEndpointLifecycle` 管理；停止可结束等待 ready 的启动，旧连接与旧 fetch 的迟到回调不能进入新连接。轮询锁覆盖邮件解析与运行时分发，同实例按 mailbox、UIDVALIDITY、UID 去重（完成记录最多 10,000 封、24 小时；满载拒绝新 admission），同 UID 在飞处理共享结果，处理失败允许下一次轮询重试。UIDVALIDITY 变化或端点停止会清空记录；无 UIDVALIDITY 不推断跨连接 UID 身份。

`markSeen: true` 在 IMAP fetch 时设置已读，而不是业务成功后确认，因此业务失败后不保证自动重取；重试验收可设置 `markSeen: false`，仍需业务自身幂等。实例缓存不提供跨进程重启去重，重启后同一未读邮件可能再次触发命令。SMTP 结果不明时不自动重发，避免服务端已接受 DATA 后重复邮件。

本地 MIME 测试验证 Markdown 的 HTML/纯文本、share 标题描述地址及 CID 内嵌图片；这不等同于真实邮箱服务与客户端互通验收。

24 小时缓存只是短期防重：`markSeen: false` 下仍保持未读的同封邮件，缓存过期后会再次分发；不是“同封永不重复”。要长期保留未读但避免重复，应另行设计带 UIDVALIDITY 的已完成 UID 区间与失败空洞，并在 Host 持久化，不能用无限实例 Map 替代。

SMTP 出站只有目标地址完整接受、无 rejected/pending 且返回非空 Message-ID 才报告发送成功；仅有 Message-ID 或部分接受归为 `delivery_unconfirmed`（可能已有副作用，不重试）。明确 SMTP 4xx/5xx 拒绝归为 `platform_rejected`，原始响应与凭据不进入诊断。成功指 SMTP relay 接受，不代表邮件已送达收件箱或已读。自定义 SMTP transport 也需返回 accepted/rejected 证据。

canonical `reply` 当前未映射 `In-Reply-To`/`References`；发送前明确返回 unsupported，而非丢弃引用后发送邻接文字。邮件协议本身支持线程，此处是当前适配器实现边界。
