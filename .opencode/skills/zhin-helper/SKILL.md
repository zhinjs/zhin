---
name: zhin-helper
description: Provides guidance on working with the Zhin chatbot framework, including bot creation, plugin development, and integration with various chat platforms. Use when users ask about Zhin framework, bot development, or chat platform integration.
license: MIT
metadata:
  author: zhinjs
  version: "1.0"
  framework: zhin
---

# Zhin Framework Helper

This skill provides comprehensive guidance for working with the Zhin chatbot framework.

## What is Zhin?

Zhin is a powerful, flexible chatbot framework for Node.js that supports multiple chat platforms including:
- QQ and ICQQ
- WeChat
- Discord
- OneBot (versions 11 and 12)
- DingTalk
- And more

## Core Concepts

### 1. Bot Creation

To create a new Zhin bot:

```bash
npm init zhin-bot my-bot
cd my-bot
npm install
npm start
```

### 2. Plugin Development

Zhin uses a plugin-based architecture. A basic plugin structure:

```typescript
import { Plugin } from 'zhin';

export default class MyPlugin extends Plugin {
  constructor(ctx) {
    super(ctx);
  }

  async install() {
    // Plugin initialization logic
  }

  async uninstall() {
    // Cleanup logic
  }
}
```

### 3. Message Handling

Handle messages using middleware pattern:

```typescript
bot.middleware((session, next) => {
  // Process message
  if (session.content === 'hello') {
    return session.reply('Hi there!');
  }
  return next();
});
```

### 4. Commands

Register commands for bot interaction:

```typescript
bot.command('ping')
  .action((session) => {
    return session.reply('Pong!');
  });
```

## Platform Integration

### Connecting to Platforms

Each platform requires specific configuration:

#### QQ/ICQQ
```typescript
bot.adapter('icqq', {
  uin: 'YOUR_QQ_NUMBER',
  password: 'YOUR_PASSWORD'
});
```

#### Discord
```typescript
bot.adapter('discord', {
  token: 'YOUR_BOT_TOKEN'
});
```

## Best Practices

1. **Modular Design**: Keep plugins focused and single-purpose
2. **Error Handling**: Always handle errors gracefully
3. **Async Operations**: Use async/await for asynchronous operations
4. **Configuration**: Use configuration files for sensitive data
5. **Testing**: Write tests for your plugins

## Common Tasks

### Installing Dependencies
```bash
npm install [package-name]
```

### Running in Development
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

## Troubleshooting

### Bot Not Responding
- Check network connectivity
- Verify adapter configuration
- Review error logs

### Plugin Not Loading
- Ensure plugin is properly installed
- Check plugin dependencies
- Verify plugin configuration

## Resources

- [Zhin GitHub Repository](https://github.com/zhinjs/zhin)
- [Zhin Documentation](https://github.com/zhinjs/zhin/wiki)
- [Community Plugins](https://github.com/zhinjs)

## When to Use This Skill

Use this skill when:
- Creating a new Zhin chatbot
- Developing plugins for Zhin
- Integrating with chat platforms
- Troubleshooting Zhin-related issues
- Learning about the Zhin framework architecture
