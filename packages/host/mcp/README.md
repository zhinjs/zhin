# @zhin.js/mcp

> Zhin MCP Server - 让 AI 助手能够理解和生成 Zhin 插件

这是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 的服务插件，为 AI 助手（如 Claude、ChatGPT 等）提供 Zhin 框架的深度集成能力，让开发者能够通过 AI 对话更高效地开发 Zhin 插件。

## ✨ 特性

- 🤖 **完整的 MCP 支持**: 实现 Tools、Resources、Prompts 三大核心能力
- 🌐 **HTTP Stream 传输**: 基于 StreamableHTTPServerTransport 的现代化传输方式
- 🛠️ **丰富的开发工具**: 插件生成、命令生成、组件生成、适配器生成等
- 📚 **内置文档资源**: 提供 Zhin 架构、最佳实践、开发指南等文档
- 💡 **智能提示词**: 预设开发工作流、调试指南等提示词
- 🔍 **实时查询**: 查询当前应用的插件、命令、组件信息
- 🎯 **代码生成**: 自动生成符合 Zhin 规范的代码

## 📦 安装

```bash
pnpm add @zhin.js/mcp
```

## 🚀 快速开始

### 1. 启用插件

在 `zhin.config.ts` 中添加 MCP 插件：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: [
    'http',           // MCP 依赖 HTTP 插件
    'mcp',            // 启用 MCP Server
  ],
  mcp: {
    enabled: true,    // 启用 MCP
    path: '/mcp',     // HTTP Stream 端点路径
  }
})
```

### 2. 配置 AI 助手

#### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zhin": {
      "command": "curl",
      "args": [
        "-N",
        "http://localhost:8086/mcp"
      ]
    }
  }
}
```

确保你的 Zhin 应用正在运行，且 HTTP 插件已启用（默认端口 8086）。

#### Cursor/VSCode

安装 MCP 扩展，然后在设置中配置服务器。

### 3. 开始使用

重启 AI 助手，然后就可以通过对话开发 Zhin 插件了！

```
你: 帮我创建一个名为 welcome 的插件，当用户发送 hello 时回复欢迎消息

AI: 好的！我会使用 create_plugin 工具为你创建插件...
```

## 🛠️ 可用工具 (Tools)

### 1. create_plugin
创建一个新的 Zhin 插件文件。

**参数:**
- `name` (必需): 插件名称
- `description` (必需): 插件描述
- `features`: 功能列表 `['command', 'middleware', 'component', 'context', 'database']`
- `directory`: 保存目录，默认 `src/plugins`

**示例:**
```
创建一个名为 greeting 的插件，包含命令和中间件功能
```

### 2. create_command
生成命令代码片段。

**参数:**
- `pattern` (必需): 命令模式，如 `hello <name:text>`
- `description` (必需): 命令描述
- `hasPermission`: 是否需要权限检查

**示例:**
```
生成一个 greet <name:text> [age:number] 命令的代码
```

### 3. create_component
生成消息组件代码。

**参数:**
- `name` (必需): 组件名称
- `props` (必需): 组件属性定义
- `usesJsx`: 是否使用 JSX

**示例:**
```
创建一个名为 UserCard 的组件，包含 name 和 avatar 属性
```

### 4. create_adapter
生成平台适配器代码。

**参数:**
- `name` (必需): 适配器名称
- `description` (必需): 适配器描述
- `hasWebhook`: 是否需要 Webhook 支持

**示例:**
```
创建一个 Telegram 适配器，需要 Webhook 支持
```

### 5. create_model
生成数据库模型定义。

**参数:**
- `name` (必需): 模型名称
- `fields` (必需): 字段定义

**示例:**
```
创建一个 users 模型，包含 name, email, created_at 字段
```

### 6. query_plugin
查询现有插件的详细信息。

**参数:**
- `pluginName` (必需): 插件名称

**示例:**
```
查询 http 插件的信息
```

### 7. list_plugins
列出所有已加载的插件。

**示例:**
```
列出所有插件
```

## 📚 可用资源 (Resources)

MCP Server 提供以下文档资源：

- `zhin://docs/architecture` - Zhin 架构设计文档
- `zhin://docs/plugin-development` - 插件开发指南
- `zhin://docs/best-practices` - 开发最佳实践
- `zhin://docs/command-system` - 命令系统文档
- `zhin://docs/component-system` - 组件系统文档
- `zhin://docs/context-system` - Context 系统文档
- `zhin://examples/basic-plugin` - 基础插件示例
- `zhin://examples/command-plugin` - 命令插件示例
- `zhin://examples/adapter` - 适配器示例

AI 助手可以随时访问这些资源来了解 Zhin 的开发规范。

## 💡 可用提示词 (Prompts)

### create-plugin-workflow
创建插件的完整工作流程指导。

**参数:**
- `feature_type`: 插件功能类型 (command/middleware/component/adapter)

### debug-plugin
调试插件的步骤和技巧。

**参数:**
- `error_message`: 错误消息（可选）

### best-practices
Zhin 开发的最佳实践建议。

## 🎯 使用场景

### 场景 1: 快速创建插件

```
你: 我需要一个插件来记录用户签到，使用 /签到 命令

AI: 好的！我会创建一个签到插件，包含以下功能：
1. 命令：/签到
2. 数据库模型：存储签到记录
3. 返回签到成功信息

[使用 create_plugin 工具创建...]
```

### 场景 2: 学习最佳实践

```
你: Zhin 开发中如何正确管理资源清理？

AI: [读取 zhin://docs/best-practices 资源]
根据 Zhin 最佳实践，资源清理应该...
```

### 场景 3: 调试现有插件

```
你: 我的插件报错 "Context not found"

AI: [使用 query_plugin 查询插件信息]
让我检查一下你的插件配置...
这个错误通常是因为...
```

### 场景 4: 生成适配器

```
你: 帮我创建一个 WhatsApp 适配器

AI: [使用 create_adapter 工具]
我已经为你生成了 WhatsApp 适配器的基础代码...
```

## ⚙️ 配置选项

```typescript
interface MCPConfig {
  // 是否启用 MCP Server
  enabled: boolean; // 默认: true
  
  // HTTP Stream 端点路径
  path: string; // 默认: '/mcp'
}
```

### 配置示例

#### 基础配置

```typescript
export default defineConfig({
  mcp: {
    enabled: true,
    path: '/mcp',  // 自定义端点路径
  }
})
```

#### 完整配置

```typescript
export default defineConfig({
  plugins: [
    'http',  // 必需：MCP 依赖 HTTP 插件
    'mcp',
  ],
  http: {
    port: 8086,  // HTTP 服务器端口
  },
  mcp: {
    enabled: true,
    path: '/api/mcp',  // MCP 端点路径
  }
})
```

访问 `http://localhost:8086/api/mcp` 即可连接 MCP Server。

## 🔧 开发

### 构建

```bash
pnpm build
```

### 测试

```bash
# 测试 MCP Server
node lib/index.js
```

## 📖 相关文档

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Zhin 框架文档](https://zhin.js.org)
- [插件开发指南](https://zhin.js.org/essentials/plugins)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

---

**提示**: 如果你在使用过程中遇到问题，可以：
1. 查看 [MCP 官方文档](https://modelcontextprotocol.io)
2. 在 AI 助手中询问："如何配置 Zhin MCP Server？"
3. 提交 [GitHub Issue](https://github.com/zhinjs/zhin/issues)
