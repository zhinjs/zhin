---
name: zhin-command-middleware
description: Explains Zhin command registration, middleware flow, and permission checks. Use when building commands or message middleware in Zhin plugins.
license: MIT
metadata:
  author: zhinjs
  version: "1.0"
  framework: zhin
---

# Zhin Command & Middleware Skill

Use this skill to add message commands and middleware in Zhin plugins. It maps to `MessageCommand`, `addCommand`, and the middleware compose flow.

## Command Basics

```ts
import { usePlugin, MessageCommand } from '@zhin.js/core'

const plugin = usePlugin()

plugin.addCommand(
  new MessageCommand('ping')
    .desc('Health check command')
    .action(async (message) => {
      return 'pong'
    })
)
```

### Command Patterns

`MessageCommand` uses `segment-matcher` syntax. Example with parameters:

```ts
new MessageCommand('echo <content:text>')
  .usage('echo hello')
  .examples('echo 你好')
  .action(async (message, result) => {
    return `You said: ${result.params.content}`
  })
```

## Permission Checks

Commands can enforce permissions before matching:

```ts
new MessageCommand('admin-only')
  .permit('group(123456)')
  .permit('adapter(onebot11)')
  .action(async (message) => 'ok')
```

The built-in permission service supports:
- `adapter(name)`
- `group(id)` (use `*` to match any group)
- `private(id)`
- `channel(id)`
- `user(id)`

## Middleware Flow

Zhin composes middleware in a Koa-like onion model.

```ts
plugin.addMiddleware(async (message, next) => {
  plugin.logger.info(`Incoming: ${message.$raw}`)
  await next()
})
```

### Default Command Middleware

The core inserts a default middleware that routes messages to registered commands:

- It calls `commandService.handle(...)`
- If a command returns content, it replies via `message.$reply`

Use custom middleware for logging, auth, or throttling.

## Command + Middleware Checklist

- Commands must be registered after `usePlugin()`.
- Use `.desc/.usage/.examples` to enrich help text.
- Use middleware to pre-process or guard incoming messages.
- Ensure middleware calls `next()` unless you intentionally stop processing.
