---
title: "@zhin.js/adapter-email"
package: "@zhin.js/adapter-email"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/email/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/email/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=75b5de0301a147f8 -->

# @zhin.js/adapter-email

Zhin.js Email adapter (Plugin Runtime). Sends via SMTP and receives via IMAP, turning an email inbox into a chat channel.

## Features

- SMTP email sending (based on nodemailer)
- IMAP email receiving (based on imap + mailparser)
- Scheduled polling for unread emails
- TLS/SSL encrypted connections
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-email
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/email.ts` (`defineAdapter`)
- `@zhin.js/core` — `Endpoint.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json` (`smtp` / `imap`)

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (always `kind: 'private'`, `conversation.id` is the sender address)
Outbound: `send({ conversation, payload })` -> nodemailer (recipient is `conversation.id`; payload is rendered by gateway/core; no segment-mapper)

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **Email account** | A working SMTP sending and IMAP receiving account |
| **App-specific password** | Gmail, Outlook, etc. often require an app password |
| **Network** | Outbound must be able to connect to SMTP/IMAP ports (465/587/993, etc.) |
| **host-http** | Not required; IMAP polling is handled within the adapter |

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
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

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-email` (`instanceKey: email`).

### Optional IMAP Fields

- `checkInterval`: Polling interval (milliseconds), default `60000`
- `mailbox`: Default `INBOX`
- `markSeen`: Default `true`

### Attachment Download

When `attachments.enabled: true`, inbound email attachments are saved to disk and their information is written to the message metadata (`attachments: [{ filename, path, contentType, size }]`):

- `downloadPath`: Save directory, default `./downloads/email`
- `maxFileSize`: Maximum size per attachment (bytes), default 10MB; oversized attachments are skipped
- `allowedTypes`: MIME type allowlist; types not in the list are skipped

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| IMAP connection failure | Check host/port/TLS; app-specific password may be required |
| Not receiving new emails | Check `checkInterval` / `mailbox`; confirm inbound is only admitted after `open()` |
| SMTP send failure | `secure` must match the port; sender address must match `auth.user` |
| Duplicate email processing | Use `markSeen: true`; avoid multiple instances polling the same mailbox |

It is recommended to use environment variables for storing email passwords. Do not commit them to the repository.

## AI Tools

See `agent/skills/email.md` for skill documentation.

## Documentation Links

- [Email adapter docs](https://zhin.js.org/adapters/email)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT License
