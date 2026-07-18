# 插件开发指南

> **前置**：先跑通 [快速开始](/getting-started/)；只想安装现成插件请看 [安装插件](/guide/plugin-install)；想了解运行时如何加载与切换插件请看 [插件生命周期](/guide/plugin-lifecycle)。

本指南带你走完一个约定式插件的完整流程：**建包 → plugin.ts → 约定目录 → schema.json → Host Resources → 本地验证 → 发布**。参考手册式的目录/字段全表见 [插件系统](/essentials/plugins)。

## 插件是什么

一个插件就是一个带 `plugin.ts` 入口和 `package.json` `zhin` 清单的包。能力（命令、中间件、组件……）靠**约定目录**被发现，没有任何注册调用：

```
my-plugin/
├── package.json      # zhin 清单 + files
├── plugin.ts         # definePlugin —— 入口
├── schema.json       # 配置 JSON Schema（可选）
├── commands/         # 命令
├── middlewares/      # 中间件
└── src/              # 业务代码（被以上文件 import）
```

## 第一步：建包

```bash
mkdir my-plugin && cd my-plugin
pnpm init
```

`package.json` 需要两块关键内容——`zhin` 清单声明插件身份，`files` 声明发布内容：

```json
{
  "name": "@my-scope/zhin-plugin-my-plugin",
  "version": "0.1.0",
  "type": "module",
  "files": ["plugin.ts", "schema.json", "commands", "middlewares", "src", "lib"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@zhin.js/plugin-runtime": "^1.0.0",
    "@zhin.js/command": "^1.0.0"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [
      { "package": "@zhin.js/command", "api": "^1.0.0" }
    ],
    "plugins": []
  }
}
```

- `features` 声明你用到哪些约定目录对应的 Feature 包——用了 `commands/` 就声明 `@zhin.js/command`，用了 `middlewares/` 就加 `@zhin.js/middleware`。
- `entry` 指向源码形态的 `plugin.ts`，运行时按需编译，不需要先构建。

## 第二步：写 plugin.ts

```typescript
// plugin.ts
import { definePlugin } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin', // 规则：^[a-z][a-z0-9-]*$
  metadata: { displayName: 'My Plugin' },
  setup(context) {
    // 初始化；把清理函数登记到 lifecycle
    context.lifecycle.add(() => { /* 卸载时执行 */ })
  },
})
```

`setup` 可以 async，也可以直接 `return () => cleanup()`。没有初始化逻辑时整个 `setup` 都可以省略——纯命令插件只靠 `commands/` 目录就能工作。

## 第三步：加能力（约定目录）

加一个命令就是加一个文件：

```typescript
// commands/greet/[name:string=世界].ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '打个招呼',
  execute: ({ params }) => `你好，${params.name}！`,
})
```

挂载后命令自动带实例前缀：`/my-plugin greet [name]`。加中间件同理：

```typescript
// middlewares/log.ts
import { defineMiddleware } from '@zhin.js/middleware'
import type { Message } from '@zhin.js/core/runtime'

export default defineMiddleware<Message>({
  async handle({ input }, next) {
    console.log(`[inbound] ${input.sender}: ${input.content}`)
    await next()
  },
})
```

其余约定目录（`components/`、`tools/`、`skills/`、`agents/`、`mcp/`、`pages/`、`adapters/`）的完整表格见 [插件系统 — 约定目录全表](/essentials/plugins#约定目录全表)；命令的文件路由参数与返回值见 [命令系统](/essentials/commands)；中间件选项见 [中间件](/essentials/middleware)。

::: tip 本地导入的 `.js` 后缀
插件源码是 ESM，TypeScript 本地导入必须带扩展名：`import { helper } from '../src/helper.js'`。
:::

## 第四步：声明配置

`schema.json` 用 JSON Schema 声明配置项与默认值：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "prefix": { "type": "string", "default": "你好" }
  }
}
```

读取配置：`setup` 里用 `context.config.get()`；命令/中间件运行时直接用上下文里的 `config`。用户在 `zhin.config.yml` 的 `plugins.<instanceKey>` 下覆盖。

## 第五步：按需使用 Host Resources

数据库、定时任务、主动出站不是插件自带的，而是 Host 注入的 token 资源：

```typescript
import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    // 可选资源：has + use，缺失时降级
    if (context.resources.has(databaseHostToken)) {
      context.resources.use(databaseHostToken).define('notes', {
        text: { type: 'text', nullable: false },
      })
    }
    // 必需资源：在 definePlugin 里声明 requires，缺失即拒绝启动
    // requires: [databaseHostToken]
  },
})
```

四个内置 token（`databaseHostToken` / `scheduleHostToken` / `outboundHostToken` / `httpHostToken`）的能力表见 [插件系统 — Host Resources](/essentials/plugins#host-resources)。

## 第六步：本地验证

在任意 bot 项目（推荐从 [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 复制）里挂载你的插件：

```json
// bot 项目 package.json
{
  "zhin": {
    "plugins": [
      { "package": "@my-scope/zhin-plugin-my-plugin", "instanceKey": "my-plugin" }
    ]
  }
}
```

开发期把插件放进 bot 的 workspace（pnpm workspace 或 `file:` 依赖），然后：

```bash
pnpm install
pnpm dev        # zhin runtime start，保存文件即热重载
```

在终端/沙盒里发 `/my-plugin greet` 验证。`instanceKey` 同时是命令前缀和 `zhin.config.yml` 的配置键。

## 第七步：测试

约定目录的文件是普通模块，可以直接用 Vitest 单测（形态参考 `plugins/utils/repeater/tests`）：

```typescript
// tests/greet.test.ts
import { describe, expect, it } from 'vitest'
import { parseCommandDefinition } from '@zhin.js/command'
import greet from '../commands/greet/[name:string=世界].ts'

describe('greet', () => {
  it('是合法的命令定义', () => {
    expect(parseCommandDefinition(greet)).toBe(greet)
  })

  it('回显名字', async () => {
    const result = await greet.execute({ params: { name: '小明' } } as never)
    expect(result).toBe('你好，小明！')
  })
})
```

业务逻辑建议沉到 `src/` 里，命令/中间件只做薄壳，这样大部分代码不依赖运行时即可测试。

## 第八步：发布

```bash
pnpm build
npm publish --access public
```

发布前检查：

- `files` 覆盖 `plugin.ts`、`schema.json` 和所有约定目录（漏掉目录 = 线上能力消失）。
- 有 `prepublishOnly` 构建脚本（仓库对带 `agent/` 的插件有对应 harness 检查）。
- `zhin.features` 与实际使用的约定目录一一对应。
- README 写明安装方式与 `zhin.plugins` 挂载示例。

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 命令没出现 | 目录/文件名不合规，或 `features` 没声明 `@zhin.js/command` | 名字只用小写字母/数字/连字符；补齐 `zhin.features` |
| 动态参数不生效 | 动态段不在末尾，或写成了目录段 | 参数只能放在最后一个文件段：`[name:type].ts` |
| 启动报 `Missing resource` | `requires` 声明的 token 未注入 | 改用 `has`+`use` 降级，或由 Host 提供该资源 |
| 插件没挂载 | bot 项目 `zhin.plugins` 未声明 | 加 `{ package, instanceKey }` 后 `pnpm install` |
| 类型报错 | 本地导入缺 `.js` 后缀 | `import { x } from './y.js'` |

::: info legacy 路径
旧的 `usePlugin()` / `MessageCommand` / `plugin.yml` 写法属于旧 Feature registry（`zhin dev` 路径）；新插件请使用本文的约定式结构。
:::

## 下一步

- [插件生命周期](/guide/plugin-lifecycle) — 发现、装配、代际切换与卸载
- [插件系统](/essentials/plugins) — 约定目录与 package.json 参考手册
- [命令系统](/essentials/commands) — 参数、上下文与返回值
- [消息如何流转](/essentials/message-flow) — 理解消息进出
- [AI 模块](/advanced/ai) — 接入大模型与 Agent
