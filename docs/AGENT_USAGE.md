# GitHub Copilot 自定义 Agent 使用指南

本文档介绍如何在 Zhin.js 项目中使用 GitHub Copilot 自定义 Agent。

## 📖 概述

Zhin.js 项目包含三个专业的 GitHub Copilot Agent，每个 Agent 专注于特定的开发领域，提供精准的代码建议和完整的实现模板。

## 🎯 Agent 简介

### 1. Zhin Agent (通用框架开发助手)
- **文件**: `.github/agents/zhin.agent.md`
- **适用场景**: Zhin.js 框架的通用开发任务
- **特点**: 生成完整可运行的代码，无占位符

### 2. Plugin Developer Agent (插件开发专家)
- **文件**: `.github/agents/plugin-developer.agent.md`
- **适用场景**: 开发和维护 Zhin.js 插件
- **特点**: 提供完整的插件架构和7个详细模板

### 3. Adapter Developer Agent (适配器开发专家)
- **文件**: `.github/agents/adapter-developer.agent.md`
- **适用场景**: 为聊天平台创建适配器
- **特点**: WebSocket 和 HTTP 轮询两种完整实现

## 💡 使用方法

### 基础使用

GitHub Copilot 会自动根据你的代码上下文选择合适的 Agent。你无需手动指定，只需：

1. **在相关文件中编写代码**
   - 在 `plugins/` 目录：自动使用 Plugin Developer Agent
   - 在 `adapters/` 目录：自动使用 Adapter Developer Agent
   - 其他位置：使用通用 Zhin Agent

2. **使用注释提示**
   ```typescript
   // 创建一个积分系统插件，包含数据库模型和命令
   ```
   Copilot 会根据上下文和注释生成相应代码。

### 高级使用

#### 明确指定 Agent（通过提示词）

虽然 GitHub Copilot 的自定义 Agent 系统会自动选择，但你可以通过明确的提示词来引导：

```typescript
// 使用插件开发最佳实践创建用户管理插件
// 要求：包含数据库模型、命令、中间件和 Web 界面
```

#### 请求特定模板

```typescript
// 使用模板 3: 数据库集成
// 创建一个用户积分系统
```

## 📝 常见使用场景

### 场景 1: 创建新插件

**步骤**:
1. 创建文件 `plugins/my-plugin/src/index.ts`
2. 输入注释: `// 创建一个完整的插件，包含命令和数据库`
3. Copilot 会生成完整的插件结构

**预期输出**:
- 完整的 import 语句
- 插件配置 Schema
- 命令定义
- 数据库模型
- 错误处理

### 场景 2: 创建适配器

**步骤**:
1. 创建文件 `adapters/telegram/src/index.ts`
2. 输入注释: `// 创建 Telegram 适配器，使用 WebSocket 连接`
3. Copilot 会生成完整的适配器实现

**预期输出**:
- Bot 类实现
- WebSocket 连接管理
- 消息格式转换
- 事件触发
- 类型声明

### 场景 3: 添加命令

**步骤**:
1. 在插件文件中添加注释
2. `// 添加一个积分转账命令，支持 @ 用户`
3. Copilot 会生成完整的命令实现

**预期输出**:
```typescript
addCommand(new MessageCommand('transfer <user:at> <amount:number>')
  .description('转账积分给其他用户')
  .action(async (message, result) => {
    // 完整的转账逻辑，包含验证和错误处理
  })
)
```

### 场景 4: 创建中间件

**步骤**:
1. `// 创建一个频率限制中间件，1秒内只能发送一条消息`
2. Copilot 会生成完整的中间件实现

**预期输出**:
```typescript
const userLastMessageTime = new Map<string, number>()
addMiddleware(async (message, next) => {
  // 完整的频率限制逻辑
})
```

## ✨ Agent 的优势

### 1. 代码完整性
- ✅ 包含所有必需的 import 语句
- ✅ 完整的函数实现（无 `// ...` 占位符）
- ✅ 完善的错误处理和日志记录

### 2. 类型安全
- ✅ 正确的 TypeScript 类型定义
- ✅ 符合 Zhin.js 类型系统
- ✅ 类型扩展声明（`declare module`）

### 3. 最佳实践
- ✅ 遵循 Zhin.js 开发规范
- ✅ 资源清理和生命周期管理
- ✅ 性能优化建议

### 4. 一致性
- ✅ 统一的代码风格
- ✅ 标准的项目结构
- ✅ 符合框架约定

## ⚠️ 重要规范

所有 Agent 生成的代码都会遵循以下规范：

### 1. 导入路径必须使用 .js 扩展名
```typescript
// ✅ 正确
import { usePlugin } from 'zhin.js'
import { helper } from './utils.js'

// ❌ 错误
import { usePlugin } from 'zhin'
import { helper } from './utils'
```

### 2. 命令参数使用 result.params
```typescript
// ✅ 正确
addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    const name = result.params.name
  })
)
```

### 3. 资源清理
```typescript
// ✅ 正确
useContext('database', (db) => {
  const timer = setInterval(() => {}, 1000)
  return () => clearInterval(timer)
})
```

## 🔧 验证 Agent 配置

项目提供了验证脚本来确保 Agent 文件的正确性：

```bash
# 运行验证
node scripts/validate-agents.mjs
```

**验证内容**:
- ✅ 所有 Agent 文件存在
- ✅ 文件不为空
- ✅ 包含必需的章节
- ✅ Markdown 语法正确
- ✅ 包含代码示例

## 📚 学习资源

### Agent 文档
- [Zhin Agent](.github/agents/zhin.agent.md) - 查看完整的模板和规范
- [Plugin Developer Agent](.github/agents/plugin-developer.agent.md) - 插件开发详细指南
- [Adapter Developer Agent](.github/agents/adapter-developer.agent.md) - 适配器开发详细指南
- [Agents README](.github/agents/README.md) - Agent 对比和选择指南

### Zhin.js 文档
- [README](README.md) - 项目概述
- [架构设计](docs/guide/architecture.md) - 深入理解框架
- [插件开发](docs/plugin/development.md) - 插件开发指南
- [适配器开发](docs/adapter/development.md) - 适配器开发指南

## 🐛 故障排除

### Agent 没有提供预期的建议

**可能原因**:
1. 文件路径不在标准目录中
2. 注释不够清晰或详细
3. 缺少必要的上下文

**解决方法**:
1. 确保文件在 `plugins/` 或 `adapters/` 目录
2. 提供更详细的注释说明
3. 添加相关的 import 语句作为上下文

### 生成的代码不符合规范

**解决方法**:
1. 检查 Agent 文件是否完整
2. 运行验证脚本: `node scripts/validate-agents.mjs`
3. 查看 `.github/agents/` 目录下的规范文档

### 需要特定类型的实现

**解决方法**:
1. 在注释中明确说明需求
2. 引用具体的模板编号
3. 提供示例代码作为参考

## 📊 反馈与改进

如果你发现 Agent 的建议有问题或需要改进：

1. **提交 Issue**: 描述问题和预期行为
2. **Pull Request**: 直接改进 Agent 文件
3. **讨论**: 在 Discussions 中分享你的想法

## 🎓 最佳实践

### 1. 充分利用注释
在请求代码生成前，先写清楚需求：
```typescript
// 创建一个用户系统插件
// 功能：注册、登录、积分管理
// 数据模型：users 表包含 id, username, password_hash, points
// 命令：register, login, points, transfer
// 中间件：自动累积积分
```

### 2. 逐步构建
不要一次请求生成整个插件，而是分步进行：
1. 先生成基础结构
2. 再添加数据模型
3. 然后添加命令
4. 最后添加中间件和 Web 界面

### 3. 验证生成的代码
- 检查 import 路径是否正确
- 确认类型定义完整
- 测试功能是否正常

### 4. 保持一致性
- 使用 Agent 推荐的代码风格
- 遵循项目约定
- 保持命名一致

## 🚀 下一步

1. **阅读 Agent 文档**: 了解每个 Agent 的详细能力
2. **尝试示例**: 使用上述场景进行实践
3. **参考模板**: 查看 Agent 文件中的完整模板
4. **分享经验**: 帮助改进 Agent 配置

---

**提示**: 这些 Agent 是基于 Zhin.js 框架深度定制的，会随着框架更新而持续改进。建议定期查看 Agent 文件的更新。
