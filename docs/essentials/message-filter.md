# 消息过滤

Zhin.js 内置了一个基于优先级规则的消息过滤引擎 (`MessageFilterFeature`)，在 [Dispatcher Guardrail](/docs/advanced/features.md) 第一阶段拦截符合条件的消息。

## 核心概念

| 概念 | 说明 |
|---|---|
| **FilterRule** | 一条过滤规则，描述匹配条件 + 动作 (allow / deny) |
| **优先级** | 数值越大越先匹配，第一条命中的规则决定结果 |
| **默认策略** | 无规则命中时的行为，默认 `allow` |
| **多维匹配** | 同一条规则可同时限制 scope、adapter、bot、channel、sender |
| **条件逻辑** | 条件之间 AND；条件内多个值 OR |

## 配置

### 规则形式（推荐）

```yaml
message_filter:
  default_policy: allow         # 无规则匹配时的行为
  rules:
    # 拦截指定群
    - name: block-spam-groups
      action: deny
      scopes: [group]
      channels: ['123456', '789012']

    # VIP 用户全平台放行（高优先级）
    - name: allow-vip
      action: allow
      priority: 100
      senders: ['admin001', 'vip_user']

    # 正则匹配：拒绝所有 test- 开头的频道
    - name: block-test-channels
      action: deny
      scopes: [channel]
      channels: ['/^test-/']

    # 仅限 QQ 平台生效
    - name: deny-qq-private
      action: deny
      adapters: ['icqq']
      scopes: [private]
```

### 规则字段参考

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 规则唯一名称 |
| `description` | `string?` | 描述 |
| `action` | `'allow' \| 'deny'` | 匹配后的动作 |
| `priority` | `number?` | 优先级，默认 0 |
| `enabled` | `boolean?` | 是否启用，默认 true |
| `scopes` | `FilterScope[]?` | 限定消息类型：`private` / `group` / `channel` |
| `adapters` | `string[]?` | 限定适配器（支持 `/regex/`） |
| `bots` | `string[]?` | 限定 Bot 名称 |
| `channels` | `string[]?` | 限定频道/群/会话 ID（支持 `/regex/`） |
| `senders` | `string[]?` | 限定发送者 ID（支持 `/regex/`） |

### Pattern 语法

- 精确字符串：`'123456'` — 完全匹配
- 通配符：`'*'` — 匹配所有值
- 正则表达式：`'/^test-/i'` — 用 `/pattern/flags` 格式

## 插件 API

插件通过 `addFilterRule()` 动态注册规则，卸载时自动清理：

```typescript
import { usePlugin, FilterRules } from 'zhin.js'

const plugin = usePlugin()

// 添加单条规则
const dispose = plugin.addFilterRule({
  name: 'my-deny-rule',
  action: 'deny',
  scopes: ['group'],
  channels: ['spam-group-123'],
})

// 使用工厂函数创建
plugin.addFilterRule(
  FilterRules.deny('block-ads', {
    scopes: ['group'],
    senders: [/^ad-bot-/],
  })
)

// 检测消息
const result = plugin.testFilter(message)
// → { allowed: boolean, matchedRule: string | null, reason: string }

// 动态调整默认策略
plugin.setDefaultFilterPolicy('deny')

// 手动移除规则
dispose()
```

### 通过 inject 访问完整 API

```typescript
const filter = plugin.inject('message-filter')

// 按名称查询规则
const rule = filter.getRule('block-spam-groups')

// 获取所有规则（按优先级排序）
const sorted = filter.sortedRules

// 修改默认策略
filter.defaultPolicy = 'deny'
```

## 示例场景

### 只处理特定群和特定用户

```yaml
message_filter:
  default_policy: deny          # 默认拒绝所有
  rules:
    - name: allow-work-groups
      action: allow
      scopes: [group]
      channels: ['work-group-1', 'work-group-2']
    - name: allow-admins
      action: allow
      senders: ['admin001', 'admin002']
      priority: 50
```

### 屏蔽特定平台的私聊

```yaml
message_filter:
  rules:
    - name: no-qq-private
      action: deny
      adapters: ['icqq']
      scopes: [private]
```

### 运行时动态过滤（插件）

```typescript
// 敏感词检测插件：临时拉黑触发敏感词的用户
plugin.addFilterRule({
  name: `temp-block-${userId}`,
  action: 'deny',
  senders: [userId],
  description: '触发敏感词临时屏蔽',
})
```

## 与其他系统的关系

| 系统 | 层级 | 说明 |
|---|---|---|
| **消息过滤** | Dispatcher Guardrail (Stage 1) | 最早拦截，被过滤的消息不进入任何后续流程 |
| **权限系统** | 命令执行前检查 | 消息可以被接收，但特定命令需要权限才能执行 |
| **中间件** | Dispatcher 之后 | 消息已通过过滤和路由后的自定义处理 |

## 调试过滤

在插件中查看消息的完整信息：

```typescript
plugin.addMiddleware(async (message, next) => {
  console.log({
    adapter: message.$adapter,
    bot: message.$bot,
    scope: message.$channel.type,
    channel: message.$channel.id,
    sender: message.$sender.id,
  })
  await next()
})
```

查看 `testFilter` 的匹配结果获取命中详情：

```typescript
const result = plugin.testFilter(message)
console.log(result.reason) // e.g. 'matched rule "block-spam" → deny'
```
