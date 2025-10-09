# @zhin.js/adapter-kook

基于 KOOK（开黑啦）的 Zhin 机器人适配器，用于连接 KOOK 机器人。

## 功能特性

- 🗣️ 支持KOOK频道和私聊消息处理
- 📨 消息发送和接收处理
- 🔄 消息格式转换和适配
- 📁 自动数据目录管理
- ⚡ 基于WebSocket的实时通信

## 安装

```bash
npm install @zhin.js/adapter-kook kook-client
```

## 配置

```javascript
// zhin.config.ts
export default {
  bots: [
    {
      context: 'kook',
      name: '123456789', // 机器人ID
      token: 'your-bot-token', // KOOK机器人Token
      data_dir: './data', // 数据目录
      // 其他KOOK配置项...
    }
  ]
}
```

## 使用方式

适配器会自动连接KOOK服务器：
- 基于WebSocket协议通信
- 自动处理连接和断线重连
- 支持消息事件监听

## 消息处理

- 自动将KOOK消息格式转换为Zhin标准消息格式
- 支持频道消息和私聊消息
- 支持Markdown消息格式
- 提供消息回复功能

## 依赖项

- `kook-client` - KOOK客户端库
- `zhin.js` - Zhin核心框架

## 开发

```bash
npm run build  # 构建
npm run clean  # 清理构建文件
```
