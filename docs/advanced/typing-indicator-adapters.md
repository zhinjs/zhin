---
sidebar: false
maintainer: true
---

# Typing Indicator 适配器集成指南

本文档介绍如何为所有适配器启用 Typing Indicator 功能。

## 概述

Typing Indicator 功能会在 AI 处理消息时自动提示用户"正在处理中"。支持以下平台：

| 平台 | 支持类型 | 默认类型 | 说明 |
|------|----------|----------|------|
| ICQQ | reaction, message | reaction | 支持消息回应（表情） |
| Telegram | typing, reaction, message | typing | 支持输入状态 |
| Discord | typing, reaction, message | typing | 支持输入状态 |
| Kook | reaction, message | reaction | 频道/私聊表情回应；KOOK 无 typing 输入状态 API |
| Slack | typing, reaction, message | typing | 支持输入状态 |
| Lark/飞书 | typing, reaction, message | typing | 支持输入状态 |
| DingTalk/钉钉 | message | message | 只支持消息提示 |
| QQ | reaction, message | reaction | 支持消息回应 |
| OneBot11 | message | message | 只支持消息提示 |
| OneBot12 | message | message | 只支持消息提示 |
| NapCat | reaction, message | reaction | 支持消息回应 |
| GitHub | reaction | reaction | 支持 reaction |
| Satori | typing, reaction, message | typing | 支持输入状态 |
| Email | none | none | 不支持 |
| WeChat MP | message | message | 只支持消息提示 |
| Milky | message | message | 只支持消息提示 |
| Sandbox | message | message | 只支持消息提示 |

## 快速开始

### 方式一：配置文件（推荐）

在 `zhin.config.yml` 中为每个适配器配置 Typing Indicator：

```yaml
adapters:
  icqq:
    bots:
      - name: "75318"
        typingIndicator:
          enabled: true
          defaultEmoji: "⏳"
          privateConfig:
            type: "message"
            message: "正在思考中..."
          groupConfig:
            type: "reaction"
            emoji: "⏳"

  telegram:
    bots:
      - name: "bot123"
        token: "your-token"
        typingIndicator:
          enabled: true
          privateConfig:
            type: "typing"
          groupConfig:
            type: "typing"

  discord:
    bots:
      - name: "bot123"
        token: "your-token"
        typingIndicator:
          enabled: true
          privateConfig:
            type: "typing"
          groupConfig:
            type: "typing"

  kook:
    bots:
      - name: "my-kook-bot"
        token: "${KOOK_TOKEN}"
        typingIndicator:
          enabled: true
          defaultEmoji: "⏳"
          autoRemove: true
          privateConfig:
            type: "reaction"
            emoji: "⏳"
          groupConfig:
            type: "reaction"
            emoji: "⏳"
```

### 方式二：代码方式

在插件中手动启用：

```typescript
import { usePlugin, useContext } from 'zhin.js';
import { enableTypingIndicatorForBot } from '@zhin.js/agent';

const plugin = usePlugin();

// 监听适配器就绪
useContext('icqq', (adapter) => {
  for (const [botId, bot] of adapter.bots.entries()) {
    enableTypingIndicatorForBot(bot, 'icqq', {
      enabled: true,
      defaultEmoji: '⏳',
      privateConfig: {
        type: 'message',
        message: '正在思考中...',
      },
      groupConfig: {
        type: 'reaction',
        emoji: '⏳',
      },
    });
  }
});

useContext('telegram', (adapter) => {
  for (const [botId, bot] of adapter.bots.entries()) {
    enableTypingIndicatorForBot(bot, 'telegram', {
      enabled: true,
      privateConfig: {
        type: 'typing',
      },
      groupConfig: {
        type: 'typing',
      },
    });
  }
});
```

## 配置选项

### 通用配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用 |
| `defaultEmoji` | `string` | `'⏳'` | 默认表情 |
| `autoRemove` | `boolean` | `true` | 自动移除 |
| `removeDelay` | `number` | `5000` | 移除延迟（毫秒） |
| `privateConfig` | `object` | 见下文 | 私聊配置 |
| `groupConfig` | `object` | 见下文 | 群聊配置 |

### 私聊/群聊配置

| 选项 | 类型 | 说明 |
|------|------|------|
| `type` | `'message' \| 'reaction' \| 'typing' \| 'none'` | 提示类型 |
| `message` | `string` | 消息内容（type='message' 时） |
| `emoji` | `string` | 表情符号（type='reaction' 时） |
| `autoRemove` | `boolean` | 是否自动移除 |
| `removeDelay` | `number` | 移除延迟 |

## 平台特定配置

### ICQQ

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "⏳"
  privateConfig:
    type: "message"
    message: "正在思考中..."
    removeDelay: 3000
  groupConfig:
    type: "reaction"
    emoji: "⏳"
    removeDelay: 5000
```

**特点**：
- 群聊支持消息回应（表情）
- 私聊使用消息提示
- 支持自动移除

### Telegram

```yaml
typingIndicator:
  enabled: true
  privateConfig:
    type: "typing"
  groupConfig:
    type: "typing"
```

**特点**：
- 支持输入状态（typing）
- 支持消息回应
- 支持消息编辑

### Discord

```yaml
typingIndicator:
  enabled: true
  privateConfig:
    type: "typing"
  groupConfig:
    type: "typing"
```

**特点**：
- 支持输入状态（typing）
- 支持消息回应
- 支持消息编辑

### Kook

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "⏳"
  autoRemove: true
  privateConfig:
    type: "reaction"
    emoji: "⏳"
  groupConfig:
    type: "reaction"
    emoji: "⏳"
```

**特点**：
- 推荐 **reaction**（在用户消息上贴表情，不打断会话）
- 频道与私聊 API 路径不同；适配器在 `reactionId` 中记录 `channel` / `direct` 路由
- 不支持平台级 typing 输入状态（`type: typing` 会回退为 message）
- 未单独挂载 `$typingIndicator` 时，由 `@zhin.js/agent` 在 AI 事件时自动 `enableTypingIndicatorForBot` 兜底

### DingTalk/钉钉

```yaml
typingIndicator:
  enabled: true
  privateConfig:
    type: "message"
    message: "正在处理中..."
  groupConfig:
    type: "message"
    message: "正在思考中..."
```

**特点**：
- 只支持消息提示
- 不支持消息回应
- 不支持输入状态

### QQ

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "⏳"
  privateConfig:
    type: "message"
    message: "正在思考中..."
  groupConfig:
    type: "reaction"
    emoji: "⏳"
```

**特点**：
- 群聊支持消息回应
- 私聊使用消息提示

### OneBot11/12

```yaml
typingIndicator:
  enabled: true
  privateConfig:
    type: "message"
    message: "正在处理中..."
  groupConfig:
    type: "message"
    message: "正在思考中..."
```

**特点**：
- 只支持消息提示
- 不支持消息回应

### GitHub

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "👀"
  groupConfig:
    type: "reaction"
    emoji: "👀"
```

**特点**：
- 支持 reaction
- 主要用于 Issue/PR 评论

## 编程接口

### 获取管理器

```typescript
import { getAdapterTypingIndicatorManager } from '@zhin.js/agent';

const manager = getAdapterTypingIndicatorManager();
```

### 为 Bot 启用

```typescript
import { enableTypingIndicatorForBot } from '@zhin.js/agent';

const typingManager = enableTypingIndicatorForBot(bot, 'icqq', {
  enabled: true,
  defaultEmoji: '⏳',
});
```

### 开始提示

```typescript
import { startTypingForBot } from '@zhin.js/agent';

const indicator = await startTypingForBot(bot, 'icqq', {
  messageId: message.$id,
  sessionId: `${message.$channel.type}:${message.$channel.id}`,
  userId: message.$sender.id,
  sceneType: message.$channel.type,
});
```

### 停止提示

```typescript
import { stopTypingForBot } from '@zhin.js/agent';

await stopTypingForBot(bot, 'icqq', {
  sessionId: `${message.$channel.type}:${message.$channel.id}`,
});
```

### 检查平台支持

```typescript
import { getAdapterTypingIndicatorManager } from '@zhin.js/agent';

const manager = getAdapterTypingIndicatorManager();

// 检查平台是否支持
if (manager.supportsTypingIndicator('icqq')) {
  // 支持
}

// 获取平台特性
const features = manager.getPlatformFeatures('icqq');
console.log('支持 reaction:', features.supportsReaction);
console.log('支持 typing:', features.supportsTyping);
```

## 工作原理

### 自动初始化

1. Bot 连接时，检查配置中是否有 `typingIndicator` 配置
2. 如果配置了且 `enabled` 不为 `false`，自动启用 Typing Indicator
3. 根据平台特性选择合适的提示类型

### 消息处理流程

1. AI 开始处理消息时，自动显示提示
2. 根据平台和配置选择提示类型（reaction/message/typing）
3. AI 处理完成后，自动移除提示（如果配置了 `autoRemove`）

### 平台适配

1. 支持 reaction 的平台（ICQQ、Telegram、Discord 等）优先使用 reaction
2. 不支持 reaction 的平台（DingTalk、OneBot 等）使用消息提示
3. 支持 typing 的平台（Telegram、Discord 等）可以使用输入状态

## 故障排除

### 问题：Typing Indicator 没有显示

**可能原因**：
1. 配置中 `enabled` 设置为 `false`
2. 平台不支持该提示类型
3. Bot 没有相应权限

**解决方案**：
```yaml
# 确保启用
typingIndicator:
  enabled: true

# 使用平台支持的类型
typingIndicator:
  groupConfig:
    type: "message"  # 如果不支持 reaction，使用 message
```

### 问题：提示没有自动移除

**可能原因**：
1. `autoRemove` 设置为 `false`
2. Bot 没有删除消息的权限
3. 消息已过期

**解决方案**：
```yaml
typingIndicator:
  autoRemove: true
  removeDelay: 5000
```

### 问题：平台不支持 Typing Indicator

**可能原因**：
1. 平台 API 不支持
2. 平台特性配置错误

**解决方案**：
```typescript
// 检查平台支持
const manager = getAdapterTypingIndicatorManager();
if (!manager.supportsTypingIndicator('platform')) {
  console.log('平台不支持 Typing Indicator');
}
```

## 最佳实践

### 1. 根据平台选择类型

```yaml
# 支持 typing 的平台
telegram:
  typingIndicator:
    groupConfig:
      type: "typing"

# 支持 reaction 的平台
icqq:
  typingIndicator:
    groupConfig:
      type: "reaction"
      emoji: "⏳"

# 只支持 message 的平台
dingtalk:
  typingIndicator:
    groupConfig:
      type: "message"
      message: "正在思考中..."
```

### 2. 设置合理的延迟

```yaml
typingIndicator:
  autoRemove: true
  removeDelay: 5000  # 5秒后移除
  privateConfig:
    removeDelay: 3000  # 私聊3秒后移除
  groupConfig:
    removeDelay: 5000  # 群聊5秒后移除
```

### 3. 提供有意义的提示

```yaml
typingIndicator:
  privateConfig:
    type: "message"
    message: "正在处理您的请求，请稍候..."
  groupConfig:
    type: "message"
    message: "正在思考中..."
```

### 4. 测试不同平台

```typescript
// 测试所有平台
const platforms = ['icqq', 'telegram', 'discord', 'dingtalk'];
for (const platform of platforms) {
  const features = manager.getPlatformFeatures(platform);
  console.log(`${platform}:`, features);
}
```

## 参考资料

- [ICQQ Typing Indicator 配置](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/TYPING_INDICATOR.md)
- [Agent Harness Engineering](./agent-harness-engineering.md)
- [Agent 最佳实践](./agent-best-practices.md)
