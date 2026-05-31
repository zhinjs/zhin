# ICQQ Typing Indicator 配置指南

Typing Indicator 功能会在 AI 处理消息时自动提示用户"正在处理中"。

## 配置方式

在 `zhin.config.yml` 中配置 ICQQ 适配器的 `typingIndicator` 选项：

```yaml
adapters:
  icqq:
    bots:
      - name: "75318"  # QQ 号码
        # Typing Indicator 配置
        typingIndicator:
          enabled: true  # 是否启用（默认 true）
          defaultEmoji: "⏳"  # 默认表情（默认 '⏳'）
          autoRemove: true  # 处理完成后自动移除（默认 true）
          removeDelay: 5000  # 自动移除延迟，毫秒（默认 5000）
          
          # 私聊配置
          privateConfig:
            type: "message"  # 使用消息提示
            message: "正在思考中..."
            autoRemove: true
            removeDelay: 3000
          
          # 群聊配置
          groupConfig:
            type: "reaction"  # 使用消息回应（表情）
            emoji: "⏳"
            autoRemove: true
            removeDelay: 5000
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用 Typing Indicator |
| `defaultEmoji` | `string` | `'⏳'` | 默认表情符号 |
| `autoRemove` | `boolean` | `true` | 处理完成后自动移除 |
| `removeDelay` | `number` | `5000` | 自动移除延迟（毫秒） |
| `privateConfig` | `object` | 见下文 | 私聊配置 |
| `groupConfig` | `object` | 见下文 | 群聊配置 |

### 私聊配置（privateConfig）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | `'message' \| 'reaction'` | `'message'` | 提示类型 |
| `message` | `string` | `'正在思考中...'` | 消息内容（type='message' 时） |
| `emoji` | `string` | `'⏳'` | 表情符号（type='reaction' 时） |
| `autoRemove` | `boolean` | `true` | 是否自动移除 |
| `removeDelay` | `number` | `3000` | 自动移除延迟 |

### 群聊配置（groupConfig）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | `'message' \| 'reaction'` | `'reaction'` | 提示类型 |
| `message` | `string` | `'正在思考中...'` | 消息内容（type='message' 时） |
| `emoji` | `string` | `'⏳'` | 表情符号（type='reaction' 时） |
| `autoRemove` | `boolean` | `true` | 是否自动移除 |
| `removeDelay` | `number` | `5000` | 自动移除延迟 |

## 支持的提示类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `reaction` | 消息回应（表情） | 群聊（ICQQ 支持） |
| `message` | 发送消息 | 私聊、所有平台 |

## 配置示例

### 简洁模式（只使用表情）

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "💭"
  privateConfig:
    type: "reaction"
    emoji: "💭"
  groupConfig:
    type: "reaction"
    emoji: "💭"
```

### 详细模式（使用消息提示）

```yaml
typingIndicator:
  enabled: true
  defaultEmoji: "⏳"
  privateConfig:
    type: "message"
    message: "正在处理您的请求，请稍候..."
    removeDelay: 5000
  groupConfig:
    type: "message"
    message: "正在思考中..."
    removeDelay: 3000
```

### 禁用模式

```yaml
typingIndicator:
  enabled: false
```

## 自定义表情推荐

| 表情 | 含义 | 推荐场景 |
|------|------|----------|
| ⏳ | 等待中 | 通用 |
| 💭 | 思考中 | 轻量级 |
| ⚙️ | 处理中 | 技术任务 |
| 🔍 | 搜索中 | 查询任务 |
| ✍️ | 写作中 | 生成任务 |
| 🤔 | 思索中 | 复杂任务 |

## 工作原理

1. **连接时初始化**：Bot 连接成功后，根据配置自动初始化 Typing Indicator
2. **消息处理时启用**：当 AI 开始处理消息时，自动显示提示
3. **处理完成后移除**：AI 处理完成后，自动移除提示（如果配置了 autoRemove）
4. **断开时清理**：Bot 断开连接时，自动停止所有 Typing Indicator

## 注意事项

1. **ICQQ 协议支持**：消息回应功能需要 ICQQ 协议支持 `GROUP_SET_REACTION` 和 `GROUP_DEL_REACTION` 操作

2. **权限要求**：Bot 需要有消息回应的权限

3. **私聊限制**：私聊不支持消息回应，会自动使用消息提示

4. **自动清理**：默认会在处理完成后自动移除提示

5. **配置优先级**：Bot 级别的配置会覆盖适配器级别的默认配置

## 故障排除

### 问题：表情没有显示

**可能原因**：
1. ICQQ 协议不支持消息回应
2. Bot 没有权限
3. 消息 ID 无效

**解决方案**：
```yaml
# 改用消息提示
typingIndicator:
  groupConfig:
    type: "message"
    message: "正在思考中..."
```

### 问题：消息没有被删除

**可能原因**：
1. `autoRemove` 设置为 `false`
2. Bot 没有撤回权限
3. 消息已过期

**解决方案**：
```yaml
typingIndicator:
  autoRemove: true
  removeDelay: 5000
```

### 问题：Typing Indicator 没有启用

**可能原因**：
1. 配置中 `enabled` 设置为 `false`
2. 配置格式错误

**解决方案**：
```yaml
typingIndicator:
  enabled: true  # 确保设置为 true
```

## 编程方式使用

如果需要更精细的控制，可以使用编程方式：

```typescript
import { IcqqBot } from '@zhin.js/adapter-icqq';

// 检查 Bot 是否启用了 Typing Indicator
function hasTypingIndicator(bot: IcqqBot): boolean {
  return !!bot.$typingIndicator;
}

// 手动开始提示
async function startTyping(bot: IcqqBot, messageId: string, sessionId: string) {
  if (bot.$typingIndicator) {
    return await bot.$typingIndicator.start({
      messageId,
      sessionId,
      sceneType: sessionId.startsWith('group:') ? 'group' : 'private',
    });
  }
  return null;
}

// 手动停止提示
async function stopTyping(bot: IcqqBot, sessionId: string) {
  if (bot.$typingIndicator) {
    await bot.$typingIndicator.stop({ sessionId });
  }
}
```
