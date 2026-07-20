# 核心概念速查

一页看完 Zhin.js 的 6 个核心概念。完整说明见各专题页。

## 插件（Plugin）

机器人的功能单元：一个带 `plugin.ts` 和约定目录的包。

```typescript
// plugin.ts
import { definePlugin } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    context.lifecycle.add(() => { /* 卸载清理 */ })
  },
})
```

- 能力靠**约定目录**发现（`commands/`、`middlewares/`…），无需手动注册
- 挂载与实例名由使用方 `package.json` 的 `zhin.plugins[].instanceKey` 决定
- 详见 [插件系统](/essentials/plugins)

## 命令（Command）

用户触发机器人动作的方式。`commands/` 下的文件即命令，`/` 前缀触发。

```typescript
// commands/echo/[text:string].ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '复读',
  execute: ({ params }) => `你说：${params.text}`,
})
```

- 嵌套目录 → 子命令：`commands/user/list.ts` → `/user list`
- 参数写在文件名里：`[name:string|number|boolean=default].ts`，单个动态段且必须在末尾
- 项目根命令是 bare 名（`/ping`）；插件命令自动带 instanceKey 前缀（`/qrcode scan <url>`）
- 详见 [命令系统](/essentials/commands)

## 中间件（Middleware）

拦截消息流，在命令匹配/AI **之前**包裹整条入站处理。

```typescript
// middlewares/logger.ts
import { defineMiddleware } from '@zhin.js/middleware'
import type { Message } from '@zhin.js/core/runtime'

export default defineMiddleware<Message>({
  async handle({ input }, next) {
    console.log(`收到: ${input.content}`)
    await next() // 不调用 next() 即终止链路
  },
})
```

- `target: 'inbound' | 'outbound'`，`order` 控制顺序
- Runtime `Message`：`content` / `sender` / `target` / `metadata` / `$reply`（没有 `$raw` / `$channel`）
- 详见 [中间件](/essentials/middleware)

## 配置（Config）

插件用 `schema.json` 声明配置项与默认值，用户在 `zhin.config.yml` 的 `plugins.<instanceKey>` 覆盖。

```typescript
// setup 阶段
setup(context) {
  const { timeout } = context.config.get()
}

// 命令/中间件运行时
execute({ config }) { /* config 已解析合并 */ }
```

- `schema.json` 是 JSON Schema（draft 2020-12），`default` 即默认值
- 详见 [配置文件](/essentials/configuration)

## Host 资源（Resources）

数据库、定时任务、主动出站由 Host 以 token 注入，`setup` 里取用：

```typescript
import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    if (context.resources.has(scheduleHostToken)) {
      const dispose = context.resources.use(scheduleHostToken).register({
        id: 'my-plugin/tick',
        cron: '0 */5 * * * *',
        execute: () => { /* ... */ },
      })
      context.lifecycle.add(dispose)
    }
  },
})
```

- 可选资源：`has` + `use` 降级；必需资源：`definePlugin({ requires: [token] })`
- 内置 token：`databaseHostToken` / `scheduleHostToken` / `outboundHostToken` / `httpHostToken`

## 生命周期（Lifecycle）

`setup(context)` 装配即启动；清理用返回 dispose 或 `lifecycle.add`：

```typescript
export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    const timer = setInterval(() => {}, 1000)
    context.lifecycle.add(() => clearInterval(timer))
    // 或：return () => clearInterval(timer)
  },
})
```

热重载时先执行全部 dispose，再按新代码重新装配。

## 消息流转简图

```
用户消息 → Adapter → inbound 中间件链 → MessageDispatcher（/ 命令匹配）
                                          └→ 未命中 → AI Agent（如启用）
回复（SendContent）→ 渲染 → outbound 中间件链 → Adapter → 平台
```

完整流程见 [消息如何流转](/essentials/message-flow)。

## 下一步

- [消息如何流转](/essentials/message-flow) — 入站/出站一页弄清
- [配置文件](/essentials/configuration) — 所有配置项
- [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) — 最小可运行项目
