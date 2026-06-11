# Zhin CLI 测试生成功能

## 概述

Zhin CLI 的 `new` 命令现在支持自动生成测试文件，为开发者提供开箱即用的测试套件模板。

## 使用方法

### 创建插件时自动生成测试

```bash
# 创建普通插件（默认）
zhin new my-plugin

# 创建服务
zhin new my-service --type service

# 创建适配器
zhin new my-adapter --type adapter
```

### 交互式创建

如果不指定类型，CLI 会询问你要创建的插件类型：

```bash
zhin new my-plugin
# ? 请选择插件类型:
#   > 普通插件 (Plugin)
#     服务 (Service)
#     适配器 (Adapter)
```

## 生成的测试文件

所有插件类型都会在 `tests/index.test.ts` 中生成相应的测试模板。

### 1. 普通插件测试模板

生成位置：`plugins/my-plugin/tests/index.test.ts`

**包含的测试套件：**

#### Plugin Instance
- ✅ 创建插件实例
- ✅ 验证插件名称
- ✅ 验证父插件引用
- ✅ 验证 logger 存在

#### Plugin Lifecycle
- ✅ 成功启动
- ✅ 成功停止
- ✅ 触发 mounted 事件
- ✅ 触发 dispose 事件

#### Plugin Features
- ✅ 注册中间件
- ✅ 执行中间件链

#### Custom Tests
- 📝 预留自定义测试区域

**示例：**

```typescript
describe('MyPlugin Plugin', () => {
  let plugin: Plugin
  let rootPlugin: Plugin

  beforeEach(async () => {
    rootPlugin = new Plugin('/test/root-plugin.ts')
    plugin = new Plugin('/plugins/my-plugin/src/index.ts', rootPlugin)
  })

  afterEach(async () => {
    if (plugin && plugin.started) {
      await plugin.stop()
    }
  })

  // ... 测试用例
})
```

---

### 2. 服务测试模板

生成位置：`plugins/services/my-service/tests/index.test.ts`

**包含的测试套件：**

#### Service Instance
- ✅ 创建服务实例
- ✅ 验证服务类型

#### Service Methods
- 📝 验证必需方法存在
- 📝 测试方法执行

#### Service Lifecycle
- 📝 测试初始化
- 📝 测试清理逻辑

#### Service Dependencies
- 📝 测试依赖注入

#### Custom Tests
- 📝 预留自定义测试区域

**示例：**

```typescript
describe('MyService Service', () => {
  let plugin: Plugin
  let service: any

  beforeEach(async () => {
    plugin = new Plugin('/test/service-plugin.ts')
    // TODO: 初始化你的服务实例
    // service = await createYourService(plugin)
  })

  // ... 测试用例
})
```

**需要开发者完成的部分：**
1. 实现服务实例的创建逻辑
2. 添加具体的方法测试
3. 测试服务的初始化和清理
4. 测试依赖注入

---

### 3. 适配器测试模板

生成位置：`plugins/adapters/my-adapter/tests/index.test.ts`

**包含的测试套件：**

#### Adapter Instance
- ✅ 创建适配器实例
- ✅ 验证适配器名称
- ✅ 验证插件引用
- ✅ 验证 logger 存在
- ✅ 验证 bots 初始化

#### Endpoint Management
- ✅ 从配置创建 Endpoint
- ✅ 验证 createEndpoint 方法
- ✅ 验证 Endpoint 属性

#### Adapter Lifecycle
- ✅ 启动适配器
- ✅ 停止适配器
- ✅ 添加到插件适配器列表
- ✅ 从插件适配器列表移除
- ✅ 停止时清理 bots

#### Event Handling
- ✅ 监听 call.recallMessage 事件
- ✅ 监听 message.receive 事件
- ✅ 停止时移除所有监听器

#### Message Sending
- ✅ 处理 sendMessage 事件
- ✅ Endpoint 不存在时抛出错误

#### Message Receiving
- ✅ 通过中间件处理接收的消息

#### Endpoint Methods
- ✅ connect 方法
- ✅ disconnect 方法
- ✅ sendMessage 方法
- ✅ recallMessage 方法
- ✅ 连接成功
- ✅ 断开连接成功

#### Custom Tests
- 📝 预留自定义测试区域

**示例：**

```typescript
// Mock Endpoint 类（用于测试）
class MockMyAdapterBot extends EventEmitter implements Endpoint {
  // ... Endpoint 实现
}

// Mock Adapter 类（用于测试）
class MockMyAdapterAdapter extends Adapter<any, any> {
  // ... Adapter 实现
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

  // ... 测试用例
})
```

**需要开发者完成的部分：**
1. 将 Mock 类替换为实际的 Adapter 和 Endpoint 类
2. 添加平台特定的测试（如 webhook、polling 等）
3. 测试平台特定的消息格式

---

## 运行测试

生成的 `package.json` 包含以下测试脚本：

```bash
# 运行测试（单次）
pnpm test

# 监听模式
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

## 测试覆盖率目标

使用生成的测试模板，你可以快速达到以下覆盖率：

- **普通插件**: 60-70% 基础覆盖率
- **服务**: 50-60% 基础覆盖率（需要补充具体实现）
- **适配器**: 70-80% 基础覆盖率

通过添加自定义测试，可以进一步提高覆盖率至 90%+。

## 最佳实践

### 1. 立即运行测试

创建插件后，立即运行测试确保基础结构正常：

```bash
cd plugins/my-plugin
pnpm test
```

### 2. 逐步完善测试

生成的测试模板包含 TODO 注释，标记了需要开发者实现的部分：

```typescript
// TODO: 初始化你的服务实例
// service = await createYourService(plugin)
```

### 3. 添加自定义测试

在 `Custom Tests` 区域添加特定于你的插件的测试：

```typescript
describe('Custom Tests', () => {
  it('should handle specific feature', () => {
    // 你的测试逻辑
  })
})
```

### 4. 使用 TDD 开发

1. 先写测试（修改生成的模板）
2. 运行测试（应该失败）
3. 实现功能
4. 运行测试（应该通过）
5. 重构代码

### 5. 保持测试更新

当你添加新功能时，同时添加对应的测试：

```typescript
describe('New Feature', () => {
  it('should work correctly', () => {
    // 测试新功能
  })
})
```

## 示例工作流

### 创建一个新的服务

```bash
# 1. 创建服务
zhin new cache-service --type service

# 2. 进入目录
cd plugins/services/cache-service

# 3. 查看生成的测试
cat tests/index.test.ts

# 4. 实现服务逻辑
# 编辑 src/index.ts

# 5. 更新测试
# 编辑 tests/index.test.ts，取消 TODO 注释并实现

# 6. 运行测试
pnpm test

# 7. 查看覆盖率
pnpm test:coverage
```

### 创建一个新的适配器

```bash
# 1. 创建适配器
zhin new wechat --type adapter

# 2. 进入目录
cd plugins/adapters/wechat

# 3. 实现适配器
# 编辑 src/index.ts

# 4. 更新测试中的 Mock 类为实际类
# 编辑 tests/index.test.ts

# 5. 添加平台特定测试
# 在 Custom Tests 区域添加

# 6. 运行测试
pnpm test

# 7. 持续开发
pnpm test:watch
```

## 依赖

生成的 `package.json` 自动包含测试所需的依赖：

```json
{
  "devDependencies": {
    "vitest": "latest",
    "@vitest/coverage-v8": "latest"
  }
}
```

## 配置

测试使用项目根目录的 `vitest.config.ts` 配置。如果需要自定义配置，可以在插件目录创建自己的 `vitest.config.ts`。

## 故障排除

### 测试无法导入模块

确保已经构建了插件：

```bash
pnpm build
```

### 测试覆盖率低

1. 检查 TODO 注释，确保所有测试都已实现
2. 添加更多自定义测试
3. 测试边界情况和错误处理

### Mock 类型错误

确保 Mock 类实现了正确的接口：

```typescript
class MockEndpoint extends EventEmitter implements Endpoint {
  // 实现所有 Endpoint 接口方法
}
```

## 贡献

如果你发现测试模板有改进空间，欢迎提交 PR 到 `@zhin.js/cli` 仓库！

---

**Happy Testing! 🎉**
