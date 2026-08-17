# zhin.js

Zhin.js **IM 核心**主入口（4.x）：多通道 **Endpoint**、Plugin、Adapter、命令与热重载。**production 安装预算 <10MB**。

AI / Agent 能力在 **`@zhin.js/agent`**（及 `@zhin.js/ai`），须显式安装或通过 `npm create zhin-app` 向导写入依赖。详见 [ADR 0019](../../../docs/adr/0019-install-size-layering.md)。

## Install tiers

> **SSOT**：[`docs/snippets/install-tiers.md`](../../../docs/snippets/install-tiers.md)（含 Host 行扩展表）。站点：[快速开始](https://zhin.js.org/getting-started/#install-tierszhinjs-4x)。

| 档位 | 安装 | 能力 |
|------|------|------|
| **IM** | `pnpm add zhin.js` | `@zhin.js/core` 全部 API |
| **AI** | `+ @zhin.js/agent zod ai` | ZhinAgent、`ctx.ai`、会话与工具 |
| **Provider** | `+ @ai-sdk/openai` 等 | 大模型调用 |
| **Host** | 无需安装，由 `@zhin.js/cli` 自动装配 | Console API（可选 peer） |

## 子路径导出

| 子路径 | 内容 |
|--------|------|
| `zhin.js` | **仅** `@zhin.js/core` + `@zhin.js/logger` |
| `zhin.js/agent` | `@zhin.js/agent` + 多 Agent 编排（`runPipeline` / `runParallel` / `route`） |
| `zhin.js/ai` | `@zhin.js/ai` 引擎 API |
| `zhin.js/runtime` | `@zhin.js/runtime` optional-peer facade；不进入默认 IM 闭包 |
| `zhin.js/jsx*` | Satori JSX 运行时 |

**4.x breaking**：`import from 'zhin.js'` 不再含 `ZhinAgent`、`AIService`、`ModelRegistry`。请改用 `zhin.js/agent` 或 `zhin.js/ai`。

### Plugin Runtime

`@zhin.js/runtime` 是目标插件架构的 Root 生命周期权威。它从静态 manifest 构建 Plugin
instance tree，按 owner 组合 schema/config/env，通过 Feature provider 发现 capability，
并用 immutable snapshot、CAS generation 与 lease 驱动局部 HMR。

```ts
import { EsmModuleRuntime, RootRuntime } from '@zhin.js/runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules: new EsmModuleRuntime(),
  environment: { mode: 'development' },
});

await runtime.start();
```

Root Runtime 不静态依赖具体 Command、Agent、Page 或 Adapter provider；这些能力由插件
manifest 动态装配。Feature definition 校验失败时不会提交候选 generation，旧 lease 可继续
完成，最后一个 lease 释放后才回收旧资源。

## 快速开始

三步（`-y` = IM 黄金路径，无需模型 Key）：

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

打开 [console.zhin.dev](https://console.zhin.dev) → Host `http://127.0.0.1:8086` → Sandbox 发 `/hello`。

想看「一个 `bot.ts` 就是 bot」：仓库 [`examples/single-file-bot`](../../../examples/single-file-bot/)。完整安装与路径说明：[快速开始](https://zhin.js.org/getting-started/)。

向导可选启用 AI（去掉 `-y`，自动写入 agent 栈与 provider 依赖）。

### 配置文件（IM 最小示例）

```yaml
# zhin.config.yml
endpoints: []

plugins:
  - "@zhin.js/adapter-sandbox"
  - hello

ai:
  enabled: false   # 仅 IM；启用 AI 见下节
```

### 启用 AI

```bash
pnpm add @zhin.js/agent zod ai @ai-sdk/openai
```

```yaml
ai:
  enabled: true
  providers:
    openai-main:
      sdk: openai
      apiKey: "${OPENAI_API_KEY}"
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o
```

参考：[examples/full-bot](../../../examples/full-bot/)、[AI 模块文档](https://zhin.js.org/advanced/ai)。

## 编写插件

唯一启动路径：`zhin runtime start`。`plugin.ts`（或单文件 `bot.ts`）必须 default-export `definePlugin()`；能力按约定目录发现。

```typescript
// plugin.ts — 装配入口
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'hello-bot',
  metadata: { displayName: 'Hello Bot' },
  setup() {
    // 命令放到 commands/；单文件 demo 可用 setup({ addCommand })
  },
});
```

```typescript
// commands/hello/[name].ts — 路径即路由，类型在 params 中声明
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '打招呼',
  params: {
    name: { type: 'string' },
  },
  execute({ params }) {
    return `Hello, ${params.name}!`;
  },
});
```

```typescript
// tools/get_weather.ts — 须已安装 @zhin.js/agent 且挂载 tool Feature
import { defineAgentTool } from 'zhin.js/tool';

export default defineAgentTool({
  description: '查询天气',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string', description: '城市名' } },
    required: ['city'],
  },
  async execute({ city }) {
    return `${city}：晴，25°C`;
  },
});
```

最短示例：[examples/single-file-bot](../../../examples/single-file-bot/)。编排 API 从 **`zhin.js/agent`** 引入。

## 已移除：`zhin.js/node`

`zhin.js/node` 与 `bootstrapNode` **已删除且不再导出**。唯一入口为 `definePlugin()` + `zhin runtime start`。`MessageCommand` 仍 deprecated。迁移见 `.github/skills/migrate-zhin-plugin-runtime`。

## 核心概念

- **Plugin** — `definePlugin` + `package.json#zhin`；约定目录发现能力
- **Feature** — Command、Tool、Skill、Middleware、Adapter 等可挂载提供者
- **Adapter / Endpoint** — 多平台接入（QQ、Discord、Sandbox 等）
- **MessageDispatcher** — 入站消息调度（命令 vs AI 触发）
- **ZhinAgent** — `@zhin.js/agent` 提供的 IM 编排运行时（非主包默认导出）

## 多 Agent 编排

安装 agent 栈后，从 **`zhin.js/agent`** 使用 `runPipeline` / `runParallel` / `route` 等（见 [AI 模块文档](https://zhin.js.org/advanced/ai)）。

## 常用命令

```bash
pnpm dev          # 开发模式（热重载）
pnpm start        # 生产模式
npx zhin stop     # 停止守护进程
npx zhin doctor   # 诊断（含 AI 依赖）
```

## 文档

- [zhin.js.org](https://zhin.js.org/)
- [快速开始](https://zhin.js.org/getting-started/)
- [Install tiers / ADR 0019](https://zhin.js.org/adr/0019-install-size-layering)
- [AI 模块](https://zhin.js.org/advanced/ai)

## 许可证

MIT License
