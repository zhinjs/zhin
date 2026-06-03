# @zhin.js/adapter-kook

Zhin.js KOOK（开黑啦）适配器，基于 KOOK 官方 API 开发，支持频道和私聊消息。

## 功能特性

- 🗣️ 支持 KOOK 频道和私聊消息处理
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理
- ⚡ 基于 WebSocket 的实时通信
- 📝 支持 Markdown 消息格式

## 安装

```bash
pnpm add @zhin.js/adapter-kook
```

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 在 [KOOK 开发者平台](https://developer.kookapp.cn/) 创建应用并获取 |
| **邀请入服** | 将机器人邀请到目标服务器，并授予查看频道、发送消息等权限 |
| **连接方式** | 当前适配器通过 **WebSocket** 连接 KOOK（`kook-client`）；无需公网 URL |
| **host-router** | 不需要 |

必填字段见 `KookBotConfig`：`context`、`name`、`token`。

## 最小配置

```yaml
plugins:
  - "@zhin.js/adapter-kook"

bots:
  - context: kook
    name: my-kook-bot
    token: "${KOOK_TOKEN}"
```

## 配置

可选字段（见 `KookBotConfig`）：`data_dir`、`timeout`、`max_retry`、`ignore`、`logLevel`。

```yaml
bots:
  - context: kook
    name: my-kook-bot
    token: "${KOOK_TOKEN}"
    data_dir: ./data/kook
```

TypeScript 等价写法：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'kook',
      name: 'my-kook-bot',
      token: process.env.KOOK_TOKEN!,
      data_dir: './data/kook',
    },
  ],
  plugins: ['@zhin.js/adapter-kook'],
})
```

## 获取配置信息

### 1. 创建 KOOK 机器人

1. 访问 [KOOK 开发者平台](https://developer.kookapp.cn/)
2. 登录并创建应用
3. 在应用设置中获取 **Bot Token**

### 2. 配置机器人

在应用设置中：
- 获取 **Bot Token**（必需）
- 将机器人邀请到需要的服务器并配置频道权限

### 3. 邀请机器人

- 在应用详情页获取邀请链接
- 将机器人邀请到需要的服务器
- 确保机器人有相应的权限

## 使用示例

### 基础消息处理

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return `你好，${result.params.name}！`
  })
)
```

### 频道消息

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  if (message.$channel.type === 'channel') {
    console.log(`频道消息：${message.$raw}`)
  }
})
```

### 私聊消息

```typescript
import { onPrivateMessage } from 'zhin.js'

onPrivateMessage(async (message) => {
  await message.$reply('收到你的私信了！')
})
```

### Markdown 消息

```typescript
addCommand(new MessageCommand('md')
  .action(async (message) => {
    return [
      {
        type: 'text',
        data: {
          text: '**这是粗体** *这是斜体*\n[链接](https://kookapp.cn)'
        }
      }
    ]
  })
)
```
### Card 消息 (卡片消息)

```typescript
addCommand(new MessageCommand('card')
    .action(async (message) => {
        logger.info(message);
        if (message.$adapter !== 'kook') {
            return "暂未适配平台！";
        } else {
            const cardMessage = [{
                type: 'card',
                theme: "secondary",
                size: "lg",
                modules: [
                    msgMod.section(
                        element.markdown("(font) 卡片信息(font)[purple](font) Card信息(font)[warning]")
                    ),
                    msgMod.container(
                        [
                            element.image('https://api.owii.cn/gif/cache/2026-01-03_07-17-15.gif')
                        ]
                    )
                ]
            }];
            return cardMessage;
        }
        return `当前平台：${message.$adapter}`;
    })
)
```

## 消息类型支持

### 接收消息类型

- ✅ 文本消息
- ✅ 图片消息
- ✅ 视频消息
- ✅ 文件消息
- ✅ Markdown 消息
- ✅ KMarkdown 消息
- ✅ 卡片消息

### 发送消息类型

- ✅ 文本消息
- ✅ 图片消息
- ✅ 视频消息
- ✅ 文件消息
- ✅ Markdown 消息
- ✅ 卡片消息

## API 方法

```typescript
const bot = app.adapters.get('kook')?.bots.get('my-kook-bot')

// 发送频道消息
await bot.sendChannelMsg(channelId, '消息内容')

// 发送私聊消息
await bot.sendPrivateMsg(userId, '消息内容')

// 撤回消息
await bot.$recallMessage(messageId)
```

## 🔧 频道管理工具（AI 可调用）

适配器自动注册了一系列频道管理工具，这些工具可以被 AI 调用，实现智能化的频道管理。

### 权限要求

| 工具 | 所需权限 | 说明 |
|------|----------|------|
| `kook_kick_user` | 管理员 | 踢出用户 |
| `kook_ban_user` | 管理员 | 将用户加入黑名单 |
| `kook_unban_user` | 管理员 | 解除用户封禁 |
| `kook_grant_role` | 管理员 | 授予用户角色 |
| `kook_revoke_role` | 管理员 | 撤销用户角色 |
| `kook_set_nickname` | 管理员 | 设置用户昵称 |
| `kook_list_roles` | 普通用户 | 查看角色列表 |
| `kook_create_role` | 服务器主人 | 创建新角色 |
| `kook_delete_role` | 服务器主人 | 删除角色 |
| `kook_list_members` | 普通用户 | 查看成员列表 |

### 使用示例

#### 通过 AI 对话管理频道

```
用户（服务器主人）：把 @小明 踢出服务器
AI：已将用户 小明 踢出服务器。

用户（管理员）：把 @捣蛋鬼 禁言，他总是发广告
AI：已将用户 捣蛋鬼 加入黑名单，原因：发布广告。

用户：查看服务器角色列表
AI：当前服务器有以下角色：
1. 管理员 (ID: 123)
2. 活跃成员 (ID: 456)
3. 新人 (ID: 789)
```

#### 编程调用

```typescript
// 获取 KOOK Bot 实例
const kookAdapter = app.adapters.get('kook')
const bot = kookAdapter?.bots.get('my-kook-bot')

// 踢出用户
await bot.kickUser(guildId, userId)

// 加入黑名单（封禁）
await bot.addToBlacklist(guildId, userId, '违规发言', 7) // 删除7天内消息

// 解除封禁
await bot.removeFromBlacklist(guildId, userId)

// 授予角色
await bot.grantRole(guildId, userId, roleId)

// 撤销角色
await bot.revokeRole(guildId, userId, roleId)

// 设置昵称
await bot.setNickname(guildId, userId, '新昵称')

// 获取角色列表
const roles = await bot.getRoleList(guildId)

// 创建角色
const newRole = await bot.createRole(guildId, '新角色')

// 删除角色
await bot.deleteRole(guildId, roleId)

// 获取成员列表
const members = await bot.getGuildMembers(guildId)
```

### 发送者权限信息

消息中的 `$sender` 现在包含 KOOK 特有的权限信息：

```typescript
interface KookSenderInfo {
  id: string;
  name: string;
  permission?: KookPermission;  // 1=普通, 2=管理员, 4=服务器主人, 5=频道管理员
  roles?: number[];             // 用户角色ID列表
  isGuildOwner?: boolean;       // 是否为服务器主人
  isAdmin?: boolean;            // 是否为管理员
}
```

#### 在插件中检查权限

```typescript
onMessage(async (message) => {
  const sender = message.$sender as KookSenderInfo;
  
  if (sender.isGuildOwner) {
    console.log('这是服务器主人的消息');
  }
  
  if (sender.isAdmin) {
    console.log('这是管理员的消息');
  }
})
```

## 连接说明

本适配器固定使用 **WebSocket** 与 KOOK 通信（由 `kook-client` 实现），无需配置 Webhook 回调地址。

## 消息 ID 格式

本适配器使用特殊的消息 ID 格式：

- 频道消息：`channel-{channelId}:{messageId}`
- 私聊消息：`private-{userId}:{messageId}`

## 注意事项

### 权限配置

确保机器人有以下权限：
- 查看频道
- 发送消息
- 管理消息（如需撤回）
- 查看服务器成员列表

### 频率限制

KOOK 有消息发送频率限制：
- 每秒最多 5 条消息
- 建议添加发送队列管理

## 故障排查

### 机器人无法收到消息

1. Token 是否正确
2. 机器人是否已加入服务器
3. 机器人是否有查看频道权限
4. WebSocket 连接是否正常（查看启动日志）

### 发送失败或频率限制

KOOK 有发送频率限制（约每秒 5 条）；建议队列化发送并检查 API 错误码。

### 如何发送卡片消息

使用 KOOK 卡片消息格式：

```typescript
await bot.sendChannelMsg(channelId, [
  {
    type: 'card',
    data: {
      // 卡片消息内容
    }
  }
])
```

## 文档链接

- [KOOK 适配器文档](https://zhin.js.org/adapters/kook)
- [适配器概览](https://zhin.js.org/essentials/adapters)
- [KOOK 开发者平台](https://developer.kookapp.cn/)
- [KOOK 开发文档](https://developer.kookapp.cn/doc/)
- [kook-client](https://github.com/zhinjs/kook-client)

## 依赖项

- `kook-client` - KOOK 客户端库
- `zhin.js` - Zhin 核心框架

## 开发

```bash
pnpm build  # 构建
pnpm clean  # 清理构建文件
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

