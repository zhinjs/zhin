# @zhin.js/adapter-process

基于进程标准输入输出的 Zhin 机器人适配器，用于命令行环境下的测试和开发。

## 功能特性

- 🖥️ 命令行交互界面
- ⌨️ 标准输入输出处理
- 🧪 测试和开发友好
- 📝 简单的消息格式
- 🔄 实时消息处理

## 安装

```bash
npm install @zhin.js/adapter-process
```

## 配置

```javascript
// zhin.config.ts
export default {
  bots: [
    {
      context: 'process',
      name: 'console-bot', // 机器人名称
    }
  ]
}
```

## 使用方式

启动后，直接在命令行中输入消息即可：

```bash
$ npm run dev
> 你好
[Bot] 收到消息：你好
[Bot] 回复：Hello World!
```

## 消息处理

- 监听 `process.stdin` 输入
- 将输入内容转换为标准消息格式
- 消息发送只会在日志中显示，不会输出到终端

## 消息格式

消息对象包含：
- `id`: 基于时间戳的消息ID
- `sender.id`: 当前进程PID
- `sender.name`: 进程标题
- `channel.id`: 进程PID
- `channel.type`: 固定为 'private'
- `content`: 文本消息内容
- `timestamp`: 消息时间戳

## 适用场景

- 🧪 插件开发测试
- 🔍 功能调试
- 📚 学习和演示
- 🛠️ 开发环境验证

## 依赖项

- `zhin.js` - Zhin核心框架
- Node.js 内置模块

## 开发

```bash
npm run build  # 构建
npm run clean  # 清理构建文件
```

## 注意事项

- 此适配器仅用于开发和测试
- 不支持图片、文件等复杂消息类型
- 消息发送仅在日志中显示