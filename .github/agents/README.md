# Zhin.js GitHub Copilot Agents

本目录包含为 Zhin.js 项目定制的 GitHub Copilot 自定义 Agent。这些 Agent 是专门针对 Zhin.js 框架不同开发领域的智能助手。

## 📁 Agent 列表

### 1. `zhin.agent.md` - Zhin 框架开发助手
**适用场景**: Zhin.js 框架的核心开发和通用代码编写

**专长领域**:
- 生成完整可运行的代码（不使用占位符）
- 严格遵循 Zhin.js 类型系统和 API 规范
- 提供完整的 import 语句和实现细节
- 遵循项目代码风格和约定

**关键功能**:
- 插件开发基础模板
- 依赖注入实现
- 命令系统开发
- 中间件编写
- JSX 组件开发
- 数据库模型定义
- HTTP API 集成
- Web 控制台页面开发

### 2. `plugin-developer.agent.md` - 插件开发专家
**适用场景**: 创建和维护 Zhin.js 插件

**专长领域**:
- 插件架构设计和模块划分
- 依赖注入实现（Context 系统）
- 命令系统开发（MessageCommand）
- 消息中间件编写（洋葱模型）
- 数据库集成（defineModel、onDatabaseReady）
- Web 界面开发（React + Vite）
- 性能优化和错误处理

**核心模板**:
1. **基础插件入口** - 标准插件结构和配置
2. **命令模块化** - 命令组织和实现
3. **数据库集成** - 数据模型和 CRUD 操作
4. **服务层设计** - 业务逻辑封装
5. **中间件开发** - 消息处理管道
6. **Web 界面** - React 组件和页面
7. **HTTP API** - RESTful API 端点

**最佳实践**:
- 完整的错误处理和日志记录
- 资源清理和生命周期管理
- 类型安全和 TypeScript 最佳实践
- 用户友好的交互设计

### 3. `adapter-developer.agent.md` - 适配器开发专家
**适用场景**: 为不同聊天平台创建适配器

**专长领域**:
- 平台 API 集成（WebSocket、HTTP 轮询等）
- 消息格式转换（平台消息 ↔ Zhin 标准消息）
- 连接管理和断线重连机制
- 事件系统正确触发
- 类型安全的适配器实现

**核心接口**:
```typescript
interface Bot<C extends Bot.Config = Bot.Config, M = any> {
  config: C
  connected: boolean
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $sendMessage(options: SendOptions): Promise<string>
  $recallMessage(messageId: string): Promise<void>
  $formatMessage(raw: M): Message<M>
}
```

**完整模板**:
1. **WebSocket 适配器** - 推荐的实时连接方式
2. **HTTP 轮询适配器** - 适用于不支持 WebSocket 的平台

**高级特性**:
- 消息队列（防止消息丢失）
- 速率限制（防止 API 限流）
- 缓存机制（减少 API 调用）
- 性能监控和调试工具

**关键规范**:
- `$sendMessage` 必须返回消息 ID
- `$formatMessage` 返回的 Message 必须包含 `$recall` 方法
- 正确触发 `message.receive`、`message.private.receive`、`message.group.receive` 事件
- 实现完善的错误处理和连接状态管理

## 🚀 使用方法

### 在 GitHub Copilot 中使用

1. **自动激活**: 当你在 Zhin.js 项目中编写代码时，这些 Agent 会自动激活
2. **选择特定 Agent**: 在需要特定领域帮助时，可以在提示中明确提到 Agent 类型

### 示例提示

#### 使用通用 Agent
```
请帮我创建一个基础的 Zhin.js 插件，包含完整的导入语句
```

#### 使用插件开发 Agent
```
@plugin-developer 请帮我创建一个积分系统插件，包含数据库模型和命令
```

#### 使用适配器开发 Agent
```
@adapter-developer 请帮我创建一个 Telegram 适配器，使用 WebSocket 连接
```

## 📋 Agent 对比

| 特性 | Zhin Agent | Plugin Developer | Adapter Developer |
|------|-----------|------------------|-------------------|
| **适用范围** | 通用框架开发 | 插件专项开发 | 适配器专项开发 |
| **详细程度** | 中等 | 非常详细 | 非常详细 |
| **模板数量** | 9 个基础模板 | 7 个完整模板 | 2 个完整模板 + 高级特性 |
| **代码完整性** | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| **错误处理** | ✅ 包含 | ✅ 详细指导 | ✅ 详细指导 |
| **最佳实践** | ✅ 包含 | ✅ 详细清单 | ✅ 详细清单 |

## 🎯 选择合适的 Agent

根据你的开发任务选择最合适的 Agent：

### 使用 Zhin Agent 当你需要：
- 快速原型开发
- 学习框架基础
- 通用代码编写
- 多种功能的组合实现

### 使用 Plugin Developer Agent 当你需要：
- 创建新插件
- 设计复杂的业务逻辑
- 数据库集成
- Web 界面开发
- 中间件和命令系统

### 使用 Adapter Developer Agent 当你需要：
- 为新平台创建适配器
- 实现平台特定功能
- 处理连接和消息转换
- 优化适配器性能

## ⚠️ 重要规范（所有 Agent 共同遵守）

### 1. 导入路径规范
```typescript
// ✅ 正确 - 必须使用 .js 扩展名
import { usePlugin, addCommand } from 'zhin.js'
import { myHelper } from './utils.js'

// ❌ 错误
import { usePlugin } from 'zhin'
import { myHelper } from './utils'
```

### 2. 命令参数访问
```typescript
// ✅ 正确 - 使用 result.params
addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    const name = result.params.name
    return `你好，${name}！`
  })
)
```

### 3. 类型扩展
```typescript
// ✅ 正确
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyService
    }
  }
}
```

### 4. 资源清理
```typescript
// ✅ 正确 - 返回清理函数
useContext('database', (db) => {
  const timer = setInterval(() => { /* ... */ }, 1000)
  return () => clearInterval(timer)
})
```

## 📚 相关文档

- [Zhin.js 主文档](../../README.md)
- [快速开始](../../docs/getting-started/index.md)
- [插件开发](../../docs/essentials/plugins.md)
- [适配器开发](../../docs/essentials/adapters.md)
- [命令系统](../../docs/essentials/commands.md)
- [AI 模块](../../docs/advanced/ai.md)

## 🤝 贡献

如果你发现 Agent 的指令有误或需要改进，欢迎提交 Issue 或 Pull Request。

### 改进建议
1. 补充更多实用模板
2. 添加常见问题解答
3. 提供更多代码示例
4. 优化 Agent 的响应质量

## 📝 维护日志

- **2024-11-19**: 创建三个专业 Agent（Zhin、Plugin Developer、Adapter Developer）
- 初始版本包含完整的模板和最佳实践指导

---

**注意**: 这些 Agent 文件不应该被直接修改，除非你了解其对 GitHub Copilot 行为的影响。如需调整，请先在测试环境验证效果。
