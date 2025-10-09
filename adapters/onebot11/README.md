# @zhin.js/adapter-onebot11

基于 OneBot v11 协议的 Zhin 机器人适配器，通过 WebSocket 连接各种支持 OneBot 协议的机器人客户端。

## 功能特性

- 🔌 OneBot v11 协议兼容
- 🌐 WebSocket 连接支持
- 🔐 Token 认证支持
- 🔄 自动重连机制
- 💓 心跳检测
- 📨 群聊和私聊消息处理
- 🛠️ 完整的API调用支持

## 安装

```bash
npm install @zhin.js/adapter-onebot11
```

## 配置

```javascript
// zhin.config.ts
export default {
  bots: [
    {
      context: 'onebot11',
      name: 'my-bot', // 机器人名称
      url: 'ws://localhost:8080', // OneBot服务器地址
      access_token: 'your-access-token', // 访问令牌（可选）
      reconnect_interval: 5000, // 重连间隔（毫秒）
      heartbeat_interval: 30000, // 心跳间隔（毫秒）
    }
  ]
}
```

## 支持的OneBot实现

- go-cqhttp
- Mirai + mirai-api-http
- Shamrock
- LagrangeGo
- 其他兼容OneBot v11协议的实现

## 功能支持

### 消息处理
- 接收群聊和私聊消息
- 发送文本、图片等消息
- 消息回复功能

### API调用
- `get_stranger_info` - 获取用户信息
- `get_group_info` - 获取群组信息
- `send_group_msg` - 发送群消息
- `send_private_msg` - 发送私聊消息

### 连接管理
- 自动重连
- 心跳保持
- 超时处理

## 使用方式

适配器会自动处理WebSocket连接：
- 支持Bearer Token认证
- 自动处理断线重连
- API请求超时管理

## 依赖项

- `ws` - WebSocket客户端库
- `zhin.js` - Zhin核心框架

## 开发

```bash
npm run build  # 构建
npm run clean  # 清理构建文件
```