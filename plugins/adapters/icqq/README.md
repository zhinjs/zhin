# @zhin.js/adapter-icqq

基于 ICQQ 的 Zhin 机器人适配器，用于连接 QQ 机器人。

## 功能特性

- 🤖 支持QQ群聊和私聊消息处理
- 🔐 完整的登录验证支持（短信验证、二维码、滑块验证）
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理

## 安装

```bash
npm install @zhin.js/adapter-icqq @icqqjs/icqq
```

## 配置

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'icqq',
      name: process.env.ICQQ_LOGIN_UIN, // QQ号
      password: process.env.ONEBOT_TOKEN, // QQ密码（可选，为空则扫码登录）
      platform: 2, // 1: 安卓手机, 2: 安卓手表, 3: MacOS, 4: 企点
      log_level: 'off', // 日志级别
      data_dir: './data', // 数据目录
      scope: 'icqqjs', // 作用域
      sign_api_addr: process.env.ICQQ_SIGN_ADDR // 签名API地址（可选）
    }
  ],
  plugins: ['adapter-icqq']
})
```

## 使用方式

适配器会自动处理登录流程：
- 支持密码登录、二维码登录
- 自动处理短信验证码输入
- 支持滑块验证

## 消息处理

- 自动将ICQQ消息格式转换为Zhin标准消息格式
- 支持群聊和私聊消息
- 提供消息回复功能

## 依赖项

- `@icqqjs/icqq` - ICQQ核心库
- `zhin.js` - Zhin核心框架

## 开发

```bash
npm run build  # 构建
npm run clean  # 清理构建文件
```