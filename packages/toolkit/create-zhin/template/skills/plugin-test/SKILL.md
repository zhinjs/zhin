---
name: plugin-test
description: "为 Zhin.js 插件编写和运行测试。Use when asked to write tests, add test coverage, generate test cases, or verify plugin behavior. 引导编写符合 Zhin 插件测试规范的 Vitest 测试用例。"
keywords:
  - 测试
  - test
  - vitest
  - 测试用例
  - test case
  - 覆盖率
  - coverage
  - 单元测试
  - unit test
tags:
  - development
  - testing
  - quality
---

# Zhin 插件测试

引导为 Zhin.js 插件编写高质量测试用例，确保功能正确、回归安全，并达到发布所需的覆盖率。

## 适用场景

- 用户说"帮我写测试"、"增加测试覆盖率"、"测试这个命令"
- 新功能需要配套测试
- 发布前需要验证测试通过

## 测试环境

Zhin 项目使用 **Vitest**，全局 API 已注入（`describe`、`it`、`expect`、`vi` 等）。

```bash
# 运行测试
pnpm test                # 单次运行
pnpm test:watch          # 监听模式
pnpm test:coverage       # 覆盖率报告
```

## 测试分类与模板

### 1. 插件生命周期测试

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Plugin } from '@zhin.js/core'

describe('MyPlugin Lifecycle', () => {
  let plugin: Plugin
  let root: Plugin

  beforeEach(() => {
    root = new Plugin('/test/root.ts')
    plugin = new Plugin('/plugins/my-plugin/src/index.ts', root)
  })

  afterEach(async () => {
    if (plugin?.started) await plugin.stop()
  })

  it('should create instance', () => {
    expect(plugin).toBeInstanceOf(Plugin)
    expect(plugin.name).toBe('my-plugin')
  })

  it('should start and stop', async () => {
    await plugin.start()
    expect(plugin.started).toBe(true)
    await plugin.stop()
    expect(plugin.started).toBe(false)
  })

  it('should emit lifecycle events', async () => {
    const mounted = vi.fn()
    const disposed = vi.fn()
    plugin.on('mounted', mounted)
    plugin.on('dispose', disposed)

    await plugin.start()
    expect(mounted).toHaveBeenCalled()

    await plugin.stop()
    expect(disposed).toHaveBeenCalled()
  })
})
```

### 2. 命令测试

优先用 `command.handle()` 走完整匹配链（与仓库 `teach-command.test.ts` 一致），不要访问私有 `_action`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MessageCommand, type Message } from 'zhin.js'

function msg(text: string): Message<any> {
  return {
    $content: [{ type: 'text', data: { text } }],
    $raw: text,
    $sender: { id: 'u1', name: 'User' },
    $reply: vi.fn(),
    $channel: { id: 'g1', type: 'group' },
    $adapter: 'sandbox',
    $endpoint: 'sandbox-bot',
  } as Message<any>
}

const mockPlugin = { contextIsReady: () => false, inject: () => null } as any

describe('greet command', () => {
  const command = new MessageCommand('greet <name:text>').action(
    async (_message, result) => `Hello, ${result.params.name}!`,
  )

  it('executes greet with parsed name', async () => {
    const output = await command.handle(msg('greet World'), mockPlugin)
    expect(output).toBe('Hello, World!')
  })
})
```

### 3. 中间件测试

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('Middleware', () => {
  it('should call next in order', async () => {
    const order: number[] = []

    const middleware1 = async (msg: any, next: () => Promise<void>) => {
      order.push(1)
      await next()
      order.push(4)
    }
    const middleware2 = async (msg: any, next: () => Promise<void>) => {
      order.push(2)
      await next()
      order.push(3)
    }

    // 模拟中间件链
    const mockMsg = { $raw: 'test' } as any
    await middleware1(mockMsg, () => middleware2(mockMsg, async () => {}))

    expect(order).toEqual([1, 2, 3, 4])
  })

  it('should intercept message when not calling next', async () => {
    const afterSpy = vi.fn()

    const filter = async (msg: any, next: () => Promise<void>) => {
      if (msg.$raw.includes('spam')) return  // 拦截
      await next()
    }

    const mockMsg = { $raw: 'this is spam' } as any
    await filter(mockMsg, afterSpy)

    expect(afterSpy).not.toHaveBeenCalled()
  })
})
```

### 4. 服务 / Context 测试

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('MyService', () => {
  it('should initialize correctly', async () => {
    // 测试服务创建逻辑（不依赖框架注入）
    const service = new MyService({ port: 3000 })
    expect(service.port).toBe(3000)
  })

  it('should cleanup on dispose', async () => {
    const service = new MyService({})
    const cleanupSpy = vi.spyOn(service, 'cleanup')

    await service.cleanup()
    expect(cleanupSpy).toHaveBeenCalled()
  })
})
```

### 5. AI 工具测试

```typescript
import { describe, it, expect } from 'vitest'
import { ZhinTool } from '@zhin.js/core'

describe('AI Tools', () => {
  it('should build tool correctly', () => {
    const tool = new ZhinTool('calculator')
      .desc('计算表达式')
      .param('expression', { type: 'string', description: '表达式' }, true)
      .execute(async (args) => String(eval(args.expression)))

    const built = tool.toTool()
    expect(built.name).toBe('calculator')
    expect(built.description).toBe('计算表达式')
    expect(built.parameters.required).toContain('expression')
  })

  it('should execute tool', async () => {
    const tool = new ZhinTool('add')
      .desc('加法')
      .param('a', { type: 'number', description: '数字a' }, true)
      .param('b', { type: 'number', description: '数字b' }, true)
      .execute(async ({ a, b }) => a + b)

    const built = tool.toTool()
    const result = await built.execute({ a: 1, b: 2 })
    expect(result).toBe(3)
  })
})
```

### 6. 定时任务测试

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('Cron Jobs', () => {
  it('should define valid cron expression', () => {
    // 验证 cron 表达式格式
    const expression = '0 9 * * 1-5'
    const parts = expression.split(' ')
    expect(parts).toHaveLength(5)
  })

  it('should execute cron callback', async () => {
    const callback = vi.fn()

    // 直接测试回调逻辑
    await callback()
    expect(callback).toHaveBeenCalled()
  })
})
```

## 覆盖率目标

发布到插件市场前建议的最低覆盖率：

| 指标 | 最低 | 推荐 |
|------|------|------|
| 语句覆盖 (Statements) | 60% | 80%+ |
| 分支覆盖 (Branches) | 50% | 70%+ |
| 函数覆盖 (Functions) | 70% | 90%+ |
| 行覆盖 (Lines) | 60% | 80%+ |

## 测试命名规范

```
tests/
├── index.test.ts           # 插件生命周期
├── commands.test.ts         # 命令逻辑
├── middlewares.test.ts      # 中间件逻辑
├── services.test.ts         # 服务/Context 逻辑
├── tools.test.ts            # AI 工具逻辑
└── integration.test.ts      # 集成测试（可选）
```

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| `Plugin` 启动失败 | 检查路径、`peerDependencies`、mock 的 root 插件 | 先跑 `plugin-init` 骨架是否可 start/stop |
| 命令 action 难测 | 直接调 action 回调或抽纯函数测逻辑 | 避免强依赖完整 IM 消息链 |
| 覆盖率不达标 | 补命令/中间件/工具单测，不堆无意义断言 | 用 `plugin-quality` 审查缺口 |
| CI 与本地结果不一致 | 对齐 Node 版本；本地 `pnpm test` 复现 | 查 vitest 配置 `isolate` |

## 🔴 CHECKPOINT · 测什么

先列出待测能力（命令/中间件/工具/服务），再写测试文件，避免只测 `start/stop` 空壳。

## 不要做什么

- 不要在测试里调用真实平台 API 或生产 token
- 不要留下 `.skip` / `.only` 进 PR
- 不要用 `eval` 测 AI 工具（用固定输入测 `execute`）
- 不要为覆盖率硬写 `expect(true).toBe(true)`
- 不要把集成测试和单元测试混在同一文件无分区

## 检查清单

- [ ] 每个命令有对应的参数解析和输出测试
- [ ] 中间件有正序和拦截测试
- [ ] 服务有初始化和清理测试
- [ ] AI 工具有构建和执行测试
- [ ] 所有测试通过 `pnpm test`
- [ ] 覆盖率满足发布要求
- [ ] 没有跳过（`.skip`）或仅运行（`.only`）的测试
