# Zhin.js 插件生态

Zhin 框架的插件生态系统，包含平台适配器、功能服务和工具类插件。

## 插件分类

### adapters/ — 平台适配器

连接不同聊天平台，使 Zhin 能够在多个平台上运行。

| 适配器 | 包名 | 说明 |
|--------|------|------|
| ICQQ | `@zhin.js/adapter-icqq` | QQ 非官方协议 |
| QQ 官方 | `@zhin.js/adapter-qq` | QQ 官方机器人 API |
| OneBot v11 | `@zhin.js/adapter-onebot11` | OneBot v11 协议 |
| KOOK | `@zhin.js/adapter-kook` | KOOK（开黑啦）|
| Discord | `@zhin.js/adapter-discord` | Discord |
| Telegram | `@zhin.js/adapter-telegram` | Telegram |
| Slack | `@zhin.js/adapter-slack` | Slack |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 钉钉 |
| 飞书 | `@zhin.js/adapter-lark` | 飞书 / Lark |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | 微信公众号 |
| Email | `@zhin.js/adapter-email` | 邮件收发 |
| Sandbox | `@zhin.js/adapter-sandbox` | 本地测试适配器 |

### services/ — 功能服务插件

提供基础设施服务的插件。

| 服务 | 包名 | 说明 |
|------|------|------|
| HTTP | `@zhin.js/http` | HTTP 服务器、路由、WebSocket |
| Console | `@zhin.js/console` | Web 控制台 |
| GitHub Notify | `@zhin.js/plugin-github-notify` | GitHub Webhook 通知 |
| MCP | `@zhin.js/plugin-mcp` | Model Context Protocol 服务 |

### utils/ — 工具类插件

提供各类实用功能的插件。

| 插件 | 包名 | 说明 |
|------|------|------|
| 60s | `@zhin.js/plugin-60s` | 每日新闻、天气查询等 |
| Voice | `@zhin.js/plugin-voice` | TTS/STT 语音功能 |
| Music | `@zhin.js/plugin-music` | 音乐搜索与分享 |
| HTML Renderer | `@zhin.js/plugin-html-renderer` | HTML/CSS 转图片 |
| Sensitive Filter | `@zhin.js/plugin-sensitive-filter` | 敏感词过滤 |

---

## 开发新插件

### 使用 CLI 创建

```bash
npx zhin new my-plugin
# 或指定类型
npx zhin new my-adapter --type adapter
npx zhin new my-service --type service
```

### 插件基本结构

```
my-plugin/
├── src/
│   └── index.ts      # 插件入口
├── package.json
├── tsconfig.json
└── README.md
```

### 插件示例

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool, declareSkill, onMounted } = usePlugin()

// 注册命令
addCommand(
  new MessageCommand('hello')
    .desc('打招呼')
    .action(() => 'Hello!')
)

// 注册 AI 工具
addTool(
  new ZhinTool('my_tool')
    .desc('我的工具')
    .execute(async () => '工具结果')
)

onMounted(() => console.log('插件已加载'))
```

### 适配器开发

适配器通过 `Adapter.register()` 注册：

```typescript
import { Adapter } from 'zhin.js'

class MyAdapter extends Adapter {
  // 实现 createBot、sendMessage 等方法
}

Adapter.register('my-platform', MyAdapter)
```

适配器可通过 `addTool()` + `declareSkill()` 将平台能力暴露给 AI。

## 插件开发规范

1. **命名规范**
   - 适配器：`@zhin.js/adapter-<name>`
   - 服务插件：`@zhin.js/<name>` 或 `@zhin.js/plugin-<name>`
   - 工具插件：`@zhin.js/plugin-<name>`

2. **依赖管理**
   - 核心依赖使用 `workspace:*`（monorepo 内）
   - 使用 `peerDependencies` 声明 `zhin.js` 依赖
   - 避免重复打包框架代码

## 许可证

MIT License
