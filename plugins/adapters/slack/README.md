# @zhin.js/adapter-slack

Slack adapter for zhin.js framework.

## Installation

```bash
pnpm add @zhin.js/adapter-slack
```

## Configuration

### Socket Mode (Recommended for Development)

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'my-slack-bot',
      context: 'slack',
      token: 'xoxb-your-bot-token',
      signingSecret: 'your-signing-secret',
      appToken: 'xapp-your-app-token',
      socketMode: true
    }
  ]
})
```

### HTTP Mode (For Production with Public URL)

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'my-slack-bot',
      context: 'slack',
      token: 'xoxb-your-bot-token',
      signingSecret: 'your-signing-secret',
      socketMode: false,
      port: 3000
    }
  ]
})
```

## Features

- ✅ Send and receive text messages
- ✅ Support for rich media (images, files)
- ✅ Message formatting (Slack mrkdwn)
- ✅ Reply to messages and threads
- ✅ Mentions (@user, #channel)
- ✅ Links and attachments
- ✅ Socket Mode and HTTP mode
- ✅ Private messages and channels

## Setting Up Your Slack App

1. Go to [Slack API](https://api.slack.com/apps)
2. Create a new app
3. Add Bot Token Scopes:
   - `chat:write` - Send messages
   - `chat:write.public` - Send messages to public channels
   - `channels:read` - View basic channel info
   - `channels:history` - View messages in channels
   - `groups:read` - View basic private channel info
   - `groups:history` - View messages in private channels
   - `im:read` - View basic direct message info
   - `im:history` - View messages in direct messages
   - `mpim:read` - View basic group direct message info
   - `mpim:history` - View messages in group direct messages
   - `users:read` - View user info
   - `files:read` - View files
   - `files:write` - Upload files
4. Enable Socket Mode (if using Socket Mode):
   - Go to Socket Mode settings
   - Enable Socket Mode
   - Generate an app-level token with `connections:write` scope
5. Subscribe to events:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
   - `message.mpim` - Group direct messages
   - `app_mention` - When the bot is mentioned
6. Install the app to your workspace
7. Copy the Bot User OAuth Token (`xoxb-...`)
8. Copy the Signing Secret
9. Copy the App-Level Token (`xapp-...`) if using Socket Mode

## Usage Examples

### Basic Message Handling

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello from Slack!'
  })
)
```

### Send Rich Messages

```typescript
addCommand(new MessageCommand('info')
  .action(async (message) => {
    return [
      { type: 'text', data: { text: '*Bold* and _italic_ text\n' } },
      { type: 'link', data: { url: 'https://slack.com', text: 'Visit Slack' } }
    ]
  })
)
```

### Mention Users

```typescript
addCommand(new MessageCommand('mention <userId:text>')
  .action(async (message, result) => {
    return [
      { type: 'at', data: { id: result.params.userId } },
      { type: 'text', data: { text: ' Hello!' } }
    ]
  })
)
```

### Reply in Thread

```typescript
addCommand(new MessageCommand('thread')
  .action(async (message) => {
    // Reply in a thread by passing the message timestamp
    await message.$reply('This is a threaded reply!', true)
  })
)
```

## Slack-Specific Features

### Slack Formatting

Slack uses mrkdwn format:
- `*bold*` for **bold**
- `_italic_` for *italic*
- `~strike~` for ~~strikethrough~~
- `` `code` `` for `code`
- `> quote` for blockquotes

### User and Channel Mentions

The adapter automatically converts:
- `<@U12345678>` to user mentions
- `<#C12345678>` to channel mentions

### File Uploads

Upload files using the `file` segment type with a local file path.

## Limitations

- Message recall requires channel information (not available from message ID alone)
- Some Slack features like interactive components require additional setup

## License

MIT
