# @zhin.js/adapter-icqq

Zhin.js ICQQ 适配器，通过 **[@icqqjs/cli](https://github.com/icqqjs/cli) 守护进程 IPC** 连接已登录的 QQ 账号，支持群聊和私聊消息。协议与登录由 CLI 负责，Zhin 侧只配置 QQ 号并连接本地/远程守护进程。

## 功能特性

- 🤖 支持 QQ 群聊和私聊消息处理
- 🔐 登录由 `icqq login` 完成（短信/二维码/滑块等由 CLI 处理）
- 🖥️ **Web 控制台登录辅助**：与 `@zhin.js/host-api` 同时启用时，在 **`/icqq`** 页面提供「概览 + 登录辅助」；HTTP 接口为 **`GET /api/login-assist/pending`**、**`POST /api/login-assist/submit`**、**`POST /api/login-assist/cancel`**（由本适配器在路由上下文中注册，依赖核心 `loginAssist` 服务）。
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理
- 🖼️ 支持图片、语音、视频等多媒体消息
- 🎯 支持 @ 提及和引用回复
- 🔧 **群管理工具**：踢人、禁言、设置管理员、群名片、头衔等（AI 可调用）
- 🔒 **权限控制**：基于群角色的工具权限过滤

## 安装

```bash
pnpm add @zhin.js/adapter-icqq
```

登录与守护进程由 **@icqqjs/cli** 提供（与适配器包解耦，可全局安装）：

```bash
pnpm add -g @icqqjs/cli
# 或：npx icqq login
```

## 配置

在 `zhin.config.yml` 中声明 bot（**不在此填写 QQ 密码**）：

```yaml
bots:
  - context: icqq
    name: "${ICQQ_ACCOUNT}"   # QQ 号，须与 icqq login 的账号一致
    autoReconnect: true         # IPC 断开后自动重连，默认 true
    # 远程 RPC（可选；默认连接 ~/.icqq/<uin>/daemon.sock）
    # rpc:
    #   host: 10.0.0.2
    #   port: 9527
    #   token: ${ICQQ_RPC_TOKEN}
    typingIndicator:          # 可选：AI 处理中的群/私聊提示
      enabled: true
      defaultEmoji: "⏳"

plugins:
  - "@zhin.js/adapter-icqq"
  - "@zhin.js/host-router"     # 可选
  - "@zhin.js/host-api"        # 可选，Remote Console /icqq 页
```

TypeScript 配置等价写法：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'icqq',
      name: process.env.ICQQ_ACCOUNT!,
    },
  ],
  plugins: ['@zhin.js/adapter-icqq'],
})
```

## 配置参数说明

### 必需参数

- `context`: 固定为 `'icqq'`
- `name`: QQ 号（字符串，与守护进程账号一致）

### 可选参数

- `autoReconnect`: IPC/RPC 意外断开时是否指数退避重连（默认 `true`）
- `rpc`: 远程守护进程连接（`host` / `port` / `token`）；不配置则使用本地 Unix socket `~/.icqq/<uin>/daemon.sock`
- `typingIndicator`: AI 处理中的 reaction 或临时消息提示（见 `IcqqBotConfig` 类型）

## 使用示例

### 基础消息处理

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return `你好，${result.params.name}！`
  })
)
```

### 群聊消息

```typescript
import { onGroupMessage } from 'zhin.js'

onGroupMessage(async (message) => {
  console.log(`群 ${message.$channel.id} 收到消息：${message.$raw}`)
  
  // 回复群消息
  await message.$reply('收到消息了！')
})
```

### 私聊消息

```typescript
import { onPrivateMessage } from 'zhin.js'

onPrivateMessage(async (message) => {
  console.log(`私聊消息来自：${message.$sender.name}`)
  await message.$reply('你好！')
})
```

### 发送图片

```typescript
addCommand(new MessageCommand('pic <url:text>')
  .action(async (message, result) => {
    return [
      { type: 'image', data: { file: result.params.url } }
    ]
  })
)
```

### 发送语音

```typescript
addCommand(new MessageCommand('voice <file:text>')
  .action(async (message, result) => {
    return [
      { type: 'record', data: { file: result.params.file } }
    ]
  })
)
```

### @ 提及

```typescript
addCommand(new MessageCommand('at <user:at>')
  .action(async (message, result) => {
    const atUser = result.params.user
    return [
      { type: 'at', data: { qq: atUser.data.qq } },
      { type: 'text', data: { text: ' 你好！' } }
    ]
  })
)
```

## 登录流程

1. **先登录 QQ**：在终端执行 `icqq login`，按 CLI 提示完成密码/扫码/滑块/设备锁等验证；会话由 `@icqqjs/cli` 守护进程维护。
2. **再启动 Zhin**：`zhin.config.yml` 中 `bots[].name` 与上一步 QQ 号一致，启动 `zhin dev` / `zhin start`；适配器连接守护进程并开始收发消息。
3. 若守护进程未运行或账号未登录，适配器会保持未连接状态，日志中会提示检查 `icqq` 守护进程。

### Web 控制台登录辅助（可选）

与 **`@zhin.js/host-api`** 同时启用时，Remote Console 的 **ICQQ 管理**（`/icqq`）可提供登录辅助 Tab，对应 API：`GET/POST /api/login-assist/*`（依赖核心 `loginAssist` 服务）。**不能替代** `icqq login`；仅用于在 Host 已运行时配合完成验证步骤。

## 消息类型支持

### 接收消息类型

- ✅ 文本消息
- ✅ 图片消息
- ✅ 语音消息
- ✅ 视频消息
- ✅ @ 提及
- ✅ 表情消息
- ✅ 引用回复
- ✅ 文件消息
- ✅ JSON 卡片消息

### 发送消息类型

- ✅ 文本消息
- ✅ 图片消息（支持本地文件、URL、Base64）
- ✅ 语音消息
- ✅ 视频消息
- ✅ @ 提及
- ✅ 表情消息
- ✅ 引用回复
- ✅ 文件消息
- ✅ JSON 卡片消息
- ✅ 戳一戳
- ✅ 音乐分享

## API 方法

```typescript
const bot = app.adapters.get('icqq')?.bots.get('你的QQ号')

// 发送群消息
await bot.sendGroupMsg(groupId, '消息内容')

// 发送私聊消息
await bot.sendPrivateMsg(userId, '消息内容')

// 撤回消息
await bot.$recallMessage(messageId)

// 获取群列表
const groupList = bot.getGroupList()

// 获取好友列表
const friendList = bot.getFriendList()

// 获取群成员信息
const memberInfo = bot.getGroupMemberInfo(groupId, userId)
```

## 🔧 群管理工具（AI 可调用）

适配器通过覆写 `IGroupManagement` 标准方法自动注册群管理工具，同时保留平台特有工具，这些工具可以被 AI 调用，实现智能化的群管理。

### 标准群管工具（自动生成）

通过覆写 `IGroupManagement` 方法，`start()` 时自动检测并生成对应 Tool：

| 工具 | 覆写方法 | 所需权限 | 说明 |
|------|---------|----------|------|
| `icqq_kick_member` | `kickMember` | 管理员 | 踢出群成员 |
| `icqq_mute_member` | `muteMember` | 管理员 | 禁言群成员 |
| `icqq_mute_all` | `muteAll` | 管理员 | 全员禁言 |
| `icqq_set_admin` | `setAdmin` | 群主 | 设置/取消管理员 |
| `icqq_set_nickname` | `setMemberNickname` | 管理员 | 设置群名片 |
| `icqq_set_group_name` | `setGroupName` | 管理员 | 修改群名称 |
| `icqq_list_members` | `listMembers` | 普通用户 | 获取群成员列表 |

### 平台特有工具（手动注册）

| 工具 | 所需权限 | 说明 |
|------|----------|------|
| `icqq_set_title` | 群主 | 设置专属头衔 |
| `icqq_announce` | 管理员 | 发送群公告 |
| `icqq_poke` | 普通用户 | 戳一戳 |
| `icqq_list_muted` | 普通用户 | 获取被禁言成员列表 |
| `icqq_send_user_like` | 普通用户 | 发送用户点赞 |
| `icqq_set_anonymous` | 管理员 | 开启/关闭匿名聊天 |
| `icqq_group_files` | 普通用户 | 获取群文件列表 |
| `icqq_friend_list` | 普通用户 | 获取好友列表 |

### 使用示例

#### 通过 AI 对话管理群

```
用户（群主）：把 @小明 踢出群并拉黑
AI：已将 小明 踢出群并拉黑。

用户（管理员）：禁言 @捣蛋鬼 1小时
AI：已禁言 捣蛋鬼 3600 秒。

用户（管理员）：发个群公告：明天下午3点开会
AI：群公告已发送。

用户：戳一戳 @朋友
AI：已戳了戳 朋友。
```

#### 编程调用

```typescript
// 获取 ICQQ Bot 实例
const icqqAdapter = app.adapters.get('icqq')
const bot = icqqAdapter?.bots.get('你的QQ号')

// 踢出成员
await bot.kickMember(groupId, userId, true) // 第三个参数为是否拉黑

// 禁言成员（单位：秒）
await bot.muteMember(groupId, userId, 600) // 禁言 10 分钟
await bot.muteMember(groupId, userId, 0)   // 解除禁言

// 全员禁言
await bot.muteAll(groupId, true)  // 开启
await bot.muteAll(groupId, false) // 关闭

// 设置管理员
await bot.setAdmin(groupId, userId, true)  // 设为管理员
await bot.setAdmin(groupId, userId, false) // 取消管理员

// 设置群名片
await bot.setCard(groupId, userId, '新名片')

// 设置专属头衔
await bot.setTitle(groupId, userId, '大佬', -1) // -1 表示永久

// 修改群名
await bot.setGroupName(groupId, '新群名')

// 发送群公告
await bot.sendAnnounce(groupId, '公告内容')

// 戳一戳
await bot.pokeMember(groupId, userId)

// 获取群成员列表
const members = await bot.getMemberList(groupId)

// 获取被禁言成员列表
const mutedList = await bot.getMutedMembers(groupId)

// 开启/关闭匿名
await bot.setAnonymous(groupId, true)
```

### 发送者权限信息

消息中的 `$sender` 包含 ICQQ 特有的权限信息：

```typescript
interface IcqqSenderInfo {
  id: string;           // QQ 号
  name: string;         // 昵称
  role?: GroupRole;     // 'owner' | 'admin' | 'member'
  isOwner?: boolean;    // 是否为群主
  isAdmin?: boolean;    // 是否为管理员
  card?: string;        // 群名片
  title?: string;       // 专属头衔
}
```

#### 在插件中检查权限

```typescript
onGroupMessage(async (message) => {
  const sender = message.$sender as IcqqSenderInfo;
  
  if (sender.isOwner) {
    console.log('这是群主的消息');
  }
  
  if (sender.isAdmin) {
    console.log('这是管理员的消息');
  }
  
  if (sender.role === 'member') {
    console.log('这是普通成员的消息');
  }
})
```

## icqq CLI 与 AI bash 安全

启用 **icqq 技能**（`skills/icqq`）时，模型通常会通过 **`bash`** 调用 `icqq …` 命令行。此时由框架 **`execSecurity` / `execApprovalMode`** 与 **Owner 私聊指令**（`approve always bash`、`approve rule <正则>` 等）共同约束：在 `allowlist` 下，**非敏感**子命令多数可直接执行；**敏感**子命令（踢人、禁言、解散、支付等）在 `execApprovalMode: ask` 时需 Owner 确认，并可用 **正则匹配整条子命令** 做持久化放行（不必把 QQ 号写进配置）。持久化文件为数据目录下的 `owner-approve-always.json`。

完整说明与指令表见仓库文档：[docs/advanced/ai.md](../../../docs/advanced/ai.md)（锚点：`#icqq-bash-exec`、`#owner-approve-commands`）。

## 注意事项

### 账号安全

- 建议使用小号测试
- 避免短时间内发送大量消息
- 保持 `@icqqjs/cli` 与适配器版本更新

### 风控与掉线

- 登录设备类型、签名服务等由 **`icqq login` / CLI 配置** 管理，不在 `zhin.config` 的 bot 段配置
- 掉线时先检查守护进程：`icqq` 是否仍在运行、账号是否被踢下线
- 可降低发消息频率，并在手机 QQ 完成安全验证后重新 `icqq login`

## 常见问题

### Q: 启动后 bot 一直未连接？

A:
1. 确认已对该 QQ 号执行过 `icqq login` 且守护进程在运行
2. 确认 `bots[].name` 与登录 QQ 号一致
3. 远程部署时检查 `rpc.host` / `rpc.port` / `rpc.token`

### Q: 还需要在 zhin.config 里写 password / platform 吗？

A: **不需要**。这些字段属于旧版直连协议，当前适配器仅通过 IPC 连接 CLI 守护进程。

### Q: 无法发送图片？

A:
1. 检查图片 URL 是否有效
2. 本地文件需使用绝对路径
3. 确认图片格式和大小符合要求

### Q: 如何处理滑块/设备锁验证？

A: 在运行 `icqq login` 的终端按提示操作；若启用了 Host API，也可在 Remote Console `/icqq` 登录辅助 Tab 提交验证码。

## 相关链接

- [@icqqjs/cli](https://github.com/icqqjs/cli)
- [ICQQ 协议库](https://github.com/icqqjs/icqq)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)
- [签名服务器](https://github.com/fuqiuluo/unidbg-fetch-qsign)

## 依赖项

- `@icqqjs/cli` - 登录与守护进程（运行时需已安装并在 PATH 中）
- `zhin.js` / `@zhin.js/core` - Zhin 框架（peer）
- `@zhin.js/host-router` / `@zhin.js/host-api` - 可选，Console 与 HTTP 路由

## 开发

```bash
pnpm build  # 构建
pnpm clean  # 清理构建文件
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
