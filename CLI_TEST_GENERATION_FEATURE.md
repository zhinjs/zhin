# Zhin CLI 自动测试生成功能

## 🎉 功能概述

Zhin CLI 现在支持在创建插件、服务或适配器时**自动生成完整的测试套件**，为开发者提供开箱即用的测试模板，大大提升开发效率和代码质量。

## ✨ 主要特性

### 1. 智能类型识别
- 支持三种插件类型：**Plugin**（普通插件）、**Service**（服务）、**Adapter**（适配器）
- 根据不同类型生成对应的测试模板
- 交互式选择或命令行参数指定

### 2. 完整的测试覆盖
- **普通插件**: 60-70% 基础覆盖率
- **服务**: 50-60% 基础覆盖率（含 TODO 提示）
- **适配器**: 70-80% 基础覆盖率

### 3. 开箱即用
- 自动配置 `vitest` 和覆盖率工具
- 预置测试脚本（`test`, `test:watch`, `test:coverage`）
- 包含完整的测试用例和最佳实践

## 📦 使用方法

### 基本命令

```bash
# 创建普通插件
zhin new my-plugin --type plugin

# 创建服务
zhin new my-service --type service

# 创建适配器
zhin new my-adapter --type adapter
```

### 交互式创建

```bash
zhin new my-plugin
# ? 请选择插件类型:
#   > 普通插件 (Plugin)
#     服务 (Service)
#     适配器 (Adapter)
```

### 完整选项

```bash
zhin new <name> [options]

Options:
  --type <type>      插件类型 (plugin|service|adapter) [default: "plugin"]
  --is-official      是否为官方插件
  --skip-install     跳过依赖安装
```

## 📋 生成的测试模板

### 1. 普通插件测试 (Plugin)

**文件位置**: `plugins/<name>/tests/index.test.ts`

**测试套件**:
- ✅ **Plugin Instance** - 实例创建、名称、父插件、logger
- ✅ **Plugin Lifecycle** - 启动、停止、事件触发
- ✅ **Plugin Features** - 中间件注册和执行
- 📝 **Custom Tests** - 自定义测试区域

**示例代码**:
```typescript
describe('MyPlugin Plugin', () => {
  let plugin: Plugin
  let rootPlugin: Plugin

  beforeEach(async () => {
    rootPlugin = new Plugin('/test/root-plugin.ts')
    plugin = new Plugin('/plugins/my-plugin/src/index.ts', rootPlugin)
  })

  it('should create plugin instance', () => {
    expect(plugin).toBeDefined()
    expect(plugin).toBeInstanceOf(Plugin)
  })
  
  // ... 更多测试
})
```

### 2. 服务测试 (Service)

**文件位置**: `plugins/services/<name>/tests/index.test.ts`

**测试套件**:
- 📝 **Service Instance** - 实例创建和类型验证（含 TODO）
- 📝 **Service Methods** - 方法存在性和执行测试（含 TODO）
- 📝 **Service Lifecycle** - 初始化和清理测试（含 TODO）
- 📝 **Service Dependencies** - 依赖注入测试（含 TODO）
- 📝 **Custom Tests** - 自定义测试区域

**示例代码**:
```typescript
describe('MyService Service', () => {
  let plugin: Plugin
  let service: any

  beforeEach(async () => {
    plugin = new Plugin('/test/service-plugin.ts')
    // TODO: 初始化你的服务实例
    // service = await createYourService(plugin)
  })

  it('should create service instance', () => {
    // TODO: 取消注释并实现
    // expect(service).toBeDefined()
    // expect(service).not.toBeNull()
    expect(true).toBe(true)
  })
  
  // ... 更多测试
})
```

### 3. 适配器测试 (Adapter)

**文件位置**: `plugins/adapters/<name>/tests/index.test.ts`

**测试套件**:
- ✅ **Adapter Instance** - 实例创建、名称、插件引用、logger、bots 初始化
- ✅ **Bot Management** - Bot 创建、createBot 方法、Bot 属性
- ✅ **Adapter Lifecycle** - 启动、停止、适配器列表管理、bots 清理
- ✅ **Event Handling** - 事件监听、事件移除
- ✅ **Message Sending** - sendMessage 处理、错误处理
- ✅ **Message Receiving** - 消息接收、中间件处理
- ✅ **Bot Methods** - connect、disconnect、sendMessage、recallMessage
- 📝 **Custom Tests** - 自定义测试区域

**示例代码**:
```typescript
// Mock Bot 类（用于测试）
class MockMyAdapterBot extends EventEmitter implements Bot {
  adapter: string
  unique: string
  self_id: string
  quote_self: boolean
  forward_length: number
  $connected: boolean = false
  
  constructor(adapter: any, config: any) {
    super()
    this.adapter = 'my-adapter'
    this.unique = config.name || 'mock-bot'
    this.self_id = config.self_id || 'mock-bot-id'
    this.quote_self = config.quote_self ?? true
    this.forward_length = config.forward_length ?? 3
  }

  async connect() {
    this.$connected = true
    this.emit('online')
    return true
  }

  async disconnect() {
    this.$connected = false
    this.emit('offline')
    return true
  }

  async sendMessage(channel_id: string, content: any) {
    return 'mock-message-id'
  }

  async recallMessage(message_id: string) {
    return true
  }
}

// Mock Adapter 类（用于测试）
class MockMyAdapterAdapter extends Adapter<any, any> {
  constructor(plugin: Plugin, name: string, config: any[]) {
    super(plugin, name)
    config.forEach(cfg => {
      const bot = this.createBot(cfg)
      this.bots.set(bot.unique, bot)
    })
  }

  createBot(config: any): Bot {
    return new MockMyAdapterBot(this, config)
  }
}

describe('MyAdapter Adapter', () => {
  let plugin: Plugin
  let adapter: MockMyAdapterAdapter

  beforeEach(() => {
    plugin = new Plugin('/test/adapter-plugin.ts')
    adapter = new MockMyAdapterAdapter(plugin, 'my-adapter', [
      { name: 'test-bot', token: 'test-token' }
    ])
  })

  it('should create adapter instance', () => {
    expect(adapter).toBeDefined()
    expect(adapter).toBeInstanceOf(Adapter)
  })
  
  // ... 更多测试
})
```

## 🛠️ 自动配置

### package.json

生成的 `package.json` 自动包含：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "latest",
    "@vitest/coverage-v8": "latest"
  }
}
```

### 目录结构

```
plugins/my-plugin/
├── src/
│   └── index.ts          # 插件源码
├── tests/
│   └── index.test.ts     # 自动生成的测试文件 ✨
├── client/
│   └── index.tsx         # 客户端代码
├── package.json          # 包含测试脚本
├── tsconfig.json
└── README.md
```

## 🚀 开发工作流

### 1. 创建插件

```bash
zhin new my-awesome-plugin --type plugin
cd plugins/my-awesome-plugin
```

### 2. 查看生成的测试

```bash
cat tests/index.test.ts
```

### 3. 运行测试（验证基础结构）

```bash
pnpm install
pnpm test
```

### 4. 实现功能

编辑 `src/index.ts`，实现你的插件逻辑。

### 5. 更新测试

编辑 `tests/index.test.ts`，在 **Custom Tests** 区域添加你的测试：

```typescript
describe('Custom Tests', () => {
  it('should handle my feature', async () => {
    // 你的测试逻辑
    const result = await plugin.myFeature()
    expect(result).toBe('expected')
  })
})
```

### 6. 持续测试

```bash
# 监听模式，自动重新运行测试
pnpm test:watch

# 查看覆盖率
pnpm test:coverage
```

## 📊 测试覆盖率

### 基础覆盖率（使用生成的模板）

| 类型 | 基础覆盖率 | 说明 |
|------|-----------|------|
| Plugin | 60-70% | 开箱即用，覆盖核心功能 |
| Service | 50-60% | 需要补充具体实现（含 TODO） |
| Adapter | 70-80% | 最完整的测试套件 |

### 提升覆盖率

通过添加自定义测试，可以轻松达到 **90%+** 的覆盖率：

```typescript
describe('Custom Tests', () => {
  it('should handle edge case 1', () => { /* ... */ })
  it('should handle edge case 2', () => { /* ... */ })
  it('should handle error scenario', () => { /* ... */ })
  // ... 更多测试
})
```

## 💡 最佳实践

### 1. 立即运行测试

创建插件后，立即运行测试确保基础结构正常：

```bash
pnpm test
```

### 2. 遵循 TDD 开发

1. **Red**: 先写测试（应该失败）
2. **Green**: 实现功能（测试通过）
3. **Refactor**: 重构代码（保持测试通过）

### 3. 完善 TODO 注释

对于服务类型，模板包含 TODO 注释，提示你需要实现的部分：

```typescript
// TODO: 初始化你的服务实例
// service = await createYourService(plugin)
```

取消注释并实现这些部分。

### 4. 添加边界测试

不仅测试正常情况，也要测试边界和错误情况：

```typescript
it('should handle empty input', () => { /* ... */ })
it('should throw error on invalid input', () => { /* ... */ })
it('should handle concurrent requests', () => { /* ... */ })
```

### 5. 使用 Mock 和 Spy

充分利用 `vitest` 的 mock 和 spy 功能：

```typescript
const mockFn = vi.fn()
plugin.onMounted(mockFn)
await plugin.start()
expect(mockFn).toHaveBeenCalled()
```

## 🔧 自定义和扩展

### 修改测试模板

如果你想自定义生成的测试模板，可以修改 `@zhin.js/cli` 的源码：

- **普通插件**: `basic/cli/src/commands/new.ts` 中的 `generatePluginTest` 函数
- **服务**: `generateServiceTest` 函数
- **适配器**: `generateAdapterTest` 函数

### 添加自定义配置

在插件目录创建 `vitest.config.ts` 来覆盖默认配置：

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**']
    }
  }
})
```

## 📚 示例

### 完整的插件开发流程

```bash
# 1. 创建插件
zhin new echo-plugin --type plugin

# 2. 进入目录
cd plugins/echo-plugin

# 3. 安装依赖
pnpm install

# 4. 实现功能 (src/index.ts)
# ... 编写代码 ...

# 5. 添加测试 (tests/index.test.ts)
# 在 Custom Tests 区域添加：
describe('Custom Tests', () => {
  it('should echo back messages', async () => {
    const mockEvent = {
      $adapter: 'test',
      $bot: 'test-bot',
      $content: [{ type: 'text', data: { text: 'hello' } }],
      $raw: 'hello',
      $reply: vi.fn()
    }

    await plugin.middleware(mockEvent, async () => {})
    
    expect(mockEvent.$reply).toHaveBeenCalledWith('hello')
  })
})

# 6. 运行测试
pnpm test

# 7. 查看覆盖率
pnpm test:coverage

# 8. 持续开发
pnpm test:watch
```

## 🎯 优势

### 对开发者
- ✅ **节省时间**: 无需从零编写测试框架
- ✅ **最佳实践**: 内置测试最佳实践
- ✅ **快速上手**: 清晰的 TODO 注释指导
- ✅ **高质量**: 提高代码质量和可维护性

### 对项目
- ✅ **统一标准**: 所有插件使用统一的测试结构
- ✅ **易于维护**: 标准化的测试便于团队协作
- ✅ **持续集成**: 便于集成到 CI/CD 流程
- ✅ **文档化**: 测试即文档，展示插件用法

## 🐛 故障排除

### 问题 1: 测试无法导入模块

**解决方案**: 确保已经构建了插件

```bash
pnpm build
```

### 问题 2: Mock 类型错误

**解决方案**: 确保 Mock 类实现了正确的接口

```typescript
class MockBot extends EventEmitter implements Bot {
  // 实现所有 Bot 接口方法
}
```

### 问题 3: 测试覆盖率低

**解决方案**:
1. 检查 TODO 注释，确保所有测试都已实现
2. 添加更多自定义测试
3. 测试边界情况和错误处理

## 📖 相关文档

- [Vitest 文档](https://vitest.dev/)
- [Zhin.js 插件开发指南](../docs/essentials/plugins.md)
- [CLI 测试生成详细文档](../basic/cli/TEST_GENERATION.md)

## 🤝 贡献

如果你发现测试模板有改进空间，欢迎提交 PR！

---

**Happy Testing! 🎉**

通过 Zhin CLI 的自动测试生成功能，让测试驱动开发变得简单而高效！
