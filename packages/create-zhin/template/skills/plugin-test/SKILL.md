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

```typescript
import { describe, it, expect } from 'vitest'
import { MessageCommand } from '@zhin.js/core'

describe('Commands', () => {
  it('should parse parameters', () => {
    const cmd = new MessageCommand('hello <name:text> [count:number=1]')
    // 验证命令定义正确
    expect(cmd.name).toBe('hello')
  })

  it('should execute command action', async () => {
    const cmd = new MessageCommand('greet <name:text>')
      .action(async (message, result) => {
        return `Hello, ${result.params.name}!`
      })

    // 模拟消息和匹配结果
    const mockMessage = { $raw: 'greet World' } as any
    const mockResult = { params: { name: 'World' } } as any

    // 直接调用 action 回调验证输出
    const callback = cmd['_action']
    if (callback) {
      const output = await callback(mockMessage, mockResult)
      expect(output).toBe('Hello, World!')
    }
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

## 检查清单

- [ ] 每个命令有对应的参数解析和输出测试
- [ ] 中间件有正序和拦截测试
- [ ] 服务有初始化和清理测试
- [ ] AI 工具有构建和执行测试
- [ ] 所有测试通过 `pnpm test`
- [ ] 覆盖率满足发布要求
- [ ] 没有跳过（`.skip`）或仅运行（`.only`）的测试
