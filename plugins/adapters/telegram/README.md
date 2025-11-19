# @zhin.js/adapter-telegram

Telegram adapter for zhin.js framework.

## Installation

```bash
pnpm add @zhin.js/adapter-telegram
```

## Configuration

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'my-telegram-bot',
      context: 'telegram',
      token: 'YOUR_BOT_TOKEN', // Get from @BotFather
      polling: true, // Use long polling (default)
      // OR use webhooks:
      // polling: false,
      // webhook: {
      //   domain: 'https://yourdomain.com',
      //   path: '/telegram-webhook',
      //   port: 8443
      // }
    }
  ]
})
```

## Features

- ✅ Send and receive text messages
- ✅ Support for rich media (images, videos, audio, documents)
- ✅ Message formatting (bold, italic, code, links)
- ✅ Reply to messages
- ✅ Mentions (@username)
- ✅ Stickers and locations
- ✅ Callback queries (inline buttons)
- ✅ Long polling and webhook modes
- ✅ Private and group chats

## Getting Your Bot Token

1. Talk to [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token provided
4. Add the token to your configuration

## Usage Examples

### Basic Message Handling

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello from Telegram!'
  })
)
```

### Send Rich Media

```typescript
addCommand(new MessageCommand('photo')
  .action(async (message) => {
    return [
      { type: 'image', data: { url: 'https://example.com/photo.jpg' } },
      { type: 'text', data: { text: 'Check out this photo!' } }
    ]
  })
)
```

### Reply to Messages

```typescript
addCommand(new MessageCommand('quote <text:text>')
  .action(async (message, result) => {
    await message.$reply(`You said: ${result.params.text}`, true) // true = quote original message
  })
)
```

## Telegram-Specific Features

### Callback Queries

The adapter automatically handles callback queries (from inline keyboards) as special messages.

### File Handling

You can send files using:
- `file_id` (from received messages)
- URL
- Local file path

## License

MIT
