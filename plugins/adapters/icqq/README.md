# @zhin.js/adapter-icqq

Zhin.js ICQQ 适配器，基于 ICQQ 库实现的 QQ 机器人适配器，支持 QQ 群聊和私聊消息。

## 功能特性

- 🤖 支持 QQ 群聊和私聊消息处理
- 🔐 完整的登录验证支持（短信验证、二维码、滑块验证）
- 🖥️ **Web 控制台登录辅助**：与 `@zhin.js/console` 同时启用时，在 **`/icqq`** 页面提供「概览 + 登录辅助」；HTTP 接口为 **`GET /api/login-assist/pending`**、**`POST /api/login-assist/submit`**、**`POST /api/login-assist/cancel`**（由本适配器在路由上下文中注册，依赖核心 `loginAssist` 服务）。
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理
- 🖼️ 支持图片、语音、视频等多媒体消息
- 🎯 支持 @ 提及和引用回复
- 🔧 **群管理工具**：踢人、禁言、设置管理员、群名片、头衔等（AI 可调用）
- 🔒 **权限控制**：基于群角色的工具权限过滤

## 安装

```bash
pnpm add @zhin.js/adapter-icqq @icqqjs/icqq
```

## 配置

### 密码登录

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'icqq',
      name: process.env.ICQQ_LOGIN_UIN,      // QQ 号（必需）
      password: process.env.ICQQ_PASSWORD,   // QQ 密码
      platform: 2,                            // 登录设备平台
      log_level: 'info',                      // 日志级别
      data_dir: './data',                     // 数据目录
      sign_api_addr: process.env.SIGN_API    // 签名 API 地址（可选）
    }
  ],
  plugins: [
    'adapter-icqq'
  ]
})
```

### 扫码登录

```typescript
export default defineConfig({
  bots: [
    {
      context: 'icqq',
      name: process.env.ICQQ_LOGIN_UIN,  // QQ 号
      password: '',                       // 留空使用扫码登录
      platform: 2,
      log_level: 'info',
      data_dir: './data'
    }
  ],
  plugins: ['adapter-icqq']
})
```

## 配置参数说明

### 必需参数

- `context`: 固定为 `'icqq'`
- `name`: QQ 账号（字符串格式）

### 可选参数

- `password`: QQ 密码（留空则使用扫码登录）
- `platform`: 登录平台类型
  - `1`: Android Phone（安卓手机）
  - `2`: Android Watch（安卓手表，推荐）
  - `3`: MacOS
  - `4`: 企点
  - `5`: iPad
- `log_level`: 日志级别
  - `'off'`: 关闭
  - `'fatal'`: 致命错误
  - `'error'`: 错误
  - `'warn'`: 警告
  - `'info'`: 信息
  - `'debug'`: 调试
  - `'trace'`: 追踪
- `data_dir`: 数据存储目录（默认：`./data`）
- `sign_api_addr`: 签名服务器地址（可选，用于提高稳定性）

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

## Web 控制台登录辅助

1. 配置中同时启用 **`@zhin.js/console`** 与本适配器（且 console 建议 **`lazyLoad: false`**，以便扩展 `addEntry` 正常注册）。
2. 打开控制台中的 **ICQQ 管理**（`/icqq`），切换到 **登录辅助** Tab；仅展示当前 **icqq** 适配器相关的待处理登录步骤。
3. 若未启用 console，仅启动机器人进程时，仍可通过日志完成登录；**不提供** Console 专属的 `/api/login-assist` 降级路径。

## 登录流程

### 密码登录

1. 配置 QQ 号和密码
2. 启动机器人
3. 如需验证，根据提示输入验证码或完成滑块验证
4. 登录成功后会保存登录状态

### 扫码登录

1. 配置 QQ 号，密码留空
2. 启动机器人
3. 扫描控制台显示的二维码
4. 手机 QQ 确认登录
5. 登录成功后会保存登录状态

### 设备锁验证

如遇设备锁：
1. 选择短信验证或扫码验证
2. 短信验证：输入收到的验证码
3. 扫码验证：扫描二维码并在手机确认

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

## 签名服务器

为了提高登录稳定性和避免风控，建议配置签名服务器：

```typescript
{
  sign_api_addr: 'http://localhost:8080/sign'  // 签名服务器地址
}
```

常用签名服务器：
- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)
- [qsign](https://github.com/MliKiowa/NapCatQQ)

## 注意事项

### 账号安全

- 建议使用小号测试
- 避免短时间内发送大量消息
- 建议配置签名服务器
- 定期更新 ICQQ 版本

### 风控问题

如遇风控：
1. 降低消息发送频率
2. 配置签名服务器
3. 更换登录设备类型（platform 参数）
4. 使用扫码登录
5. 等待一段时间后重试

### 设备选择

推荐使用的 platform 值：
- `2` (Android Watch): 最稳定，推荐
- `5` (iPad): 功能较全
- `3` (MacOS): 较稳定

避免使用：
- `1` (Android Phone): 容易被风控

## 常见问题

### Q: 登录时提示"密码错误"？

A: 
1. 确认密码是否正确
2. 尝试使用扫码登录
3. 检查是否被风控，需要在手机 QQ 上验证

### Q: 登录后频繁掉线？

A:
1. 配置签名服务器
2. 更换 platform 参数
3. 检查网络连接是否稳定
4. 降低消息发送频率

### Q: 无法发送图片？

A:
1. 检查图片 URL 是否有效
2. 本地文件需使用绝对路径
3. 确认图片格式和大小符合要求

### Q: 如何处理滑块验证？

A:
1. 控制台会显示滑块验证链接
2. 在浏览器中打开链接
3. 完成滑块验证
4. 将验证票据复制到控制台

## 相关链接

- [ICQQ 项目](https://github.com/icqqjs/icqq)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)
- [签名服务器](https://github.com/fuqiuluo/unidbg-fetch-qsign)

## 依赖项

- `@icqqjs/icqq` - ICQQ 核心库
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
