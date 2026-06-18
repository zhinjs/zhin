# 快速开始

5 分钟从零跑通一个能收发消息的机器人。

## 前置要求

- **Node.js** 20.19.0+ 或 22.12.0+
- **pnpm** 9.0+

```bash
node -v   # v20.19.0+
pnpm -v   # 9.0+
```

没有 pnpm？`npm install -g pnpm`

## 创建项目

```bash
npm create zhin-app my-bot
```

向导会引导你完成 7 步配置。新手建议：

| 步骤 | 推荐选择 | 说明 |
|------|----------|------|
| 运行时 | Node.js | 稳定 |
| 配置格式 | YAML | 最易读 |
| 数据库 | SQLite | 无需额外安装 |
| 适配器 | **Sandbox** | 调试用沙盒，必选 |
| AI | 跳过 | 跑通后再加 |

敏感信息（Token、API Key）会自动存入 `.env`，不会写进配置文件。

## 启动

```bash
cd my-bot
pnpm dev
```

看到类似输出说明启动成功：

```
[INFO] 数据库已连接
[INFO] HTTP 服务启动在 http://127.0.0.1:8086
[INFO] 适配器 sandbox 已就绪
```

## 发送第一条消息

打开 **[console.zhin.dev](https://console.zhin.dev)**：

1. API Base 填 `http://127.0.0.1:8086`
2. Token 填 `.env` 里的 `HTTP_TOKEN`
3. 进入 **沙盒** 页，连接后发送 `hello`

收到回复说明一切正常。

## 写你的第一个插件

在 `src/plugins/` 下创建 `hello.ts`：

```typescript
import { usePlugin, MessageCommand } from "zhin.js"

const { addCommand } = usePlugin()

addCommand(new MessageCommand("hello").desc("打招呼").action(() => "你好！🤖"))

addCommand(new MessageCommand("echo <text>").desc("复读").action((_, r) => r.params.text))
```

保存文件，机器人自动热重载。在沙盒发送 `hello` 或 `echo 测试`，立刻收到回复。

> **注意**：`usePlugin()` 必须在文件顶层调用，不能放在函数或回调里。详见 [常见陷阱](#常见陷阱)。

## 生产模式

```bash
pnpm start          # 无热重载，性能更好
pnpm start -- -d    # 后台运行
npx zhin stop       # 停止后台实例
```

## 接入真实平台

Sandbox 只是调试用。接入真实平台只需两步：

1. 安装适配器：`pnpm add @zhin.js/adapter-discord`（以 Discord 为例）
2. 在 `zhin.config.yml` 中添加配置

```yaml
plugins:
  - "@zhin.js/adapter-discord"

adapters:
  discord:
    - name: my-bot
      token: ${DISCORD_TOKEN}
```

所有平台的配置方式一致，详见 [平台适配器](/adapters/)。

## 启用 AI（可选）

```bash
pnpm add @zhin.js/agent zod ai @ai-sdk/openai
```

```yaml
# zhin.config.yml
ai:
  enabled: true
  providers:
    openai:
      apiKey: ${OPENAI_API_KEY}
  agents:
    zhin:
      provider: openai
      model: gpt-4o
```

重启后在沙盒发送 `ai: 你好` 即可对话。详见 [AI 模块](/advanced/ai)。

## 常见陷阱

| 陷阱 | 说明 |
|------|------|
| `usePlugin()` 放在函数里 | ❌ 必须在文件顶层调用，否则 AsyncLocalStorage 上下文丢失 |
| `getPlugin()` 在运行时调用 | ❌ 只能在插件初始化时调用，不能在命令回调、中间件里调用 |
| 导入路径没加 `.js` | ❌ TypeScript 本地导入必须写 `import { x } from './y.js'` |
| 直接调 `bot.$sendMessage()` | ❌ 必须走 `Message.$reply` 或 `Adapter.sendMessage` 发送链路 |

## 下一步

- **[插件开发完整指南](/guide/plugin-development)** — 命令、数据库、AI 工具、测试、发布
- **[消息如何流转](/essentials/message-flow)** — 一页搞清消息进出
- **[配置文件](/essentials/configuration)** — 所有配置项
- **[平台适配器](/adapters/)** — QQ、Discord、Telegram 等各平台配置
