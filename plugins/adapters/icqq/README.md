# @zhin.js/adapter-icqq

Zhin.js ICQQ 适配器，基于 ICQQ 库实现的 QQ 机器人适配器，支持 QQ 群聊和私聊消息。

## 功能特性

- 🤖 支持 QQ 群聊和私聊消息处理
- 🔐 完整的登录验证支持（短信验证、二维码、滑块验证）
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理
- 🖼️ 支持图片、语音、视频等多媒体消息
- 🎯 支持 @ 提及和引用回复

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
