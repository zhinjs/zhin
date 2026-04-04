
# Zhin.js

现代 TypeScript 聊天机器人框架 —— AI 驱动、插件化、热重载、多平台

[![文档](https://img.shields.io/badge/文档-zhin.js.org-blue)](https://zhin.js.org)
[![CI](https://github.com/zhinjs/zhin/actions/workflows/publish.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/publish.yml)
[![codecov](https://codecov.io/github/zhinjs/zhin/graph/badge.svg?token=37OE7DHMAI)](https://codecov.io/github/zhinjs/zhin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 **AI 驱动** | 内置 ZhinAgent 智能体，接入 OpenAI / Ollama 等大模型，支持多轮对话、工具调用、6 层安全防御 |
| 🔌 **插件化架构** | `usePlugin()` Hooks 风格 API，AsyncLocalStorage 上下文管理 |
| ♻️ **智能热重载** | 代码、配置变更自动生效，无需重启，错误自动回滚 |
| 🌐 **多平台** | QQ、Discord、Telegram、KOOK、Slack、钉钉、飞书、OneBot 等 14+ 平台 |
| 🧩 **Feature 体系** | 命令、工具、技能、定时任务、数据库等统一抽象，插件按需组合 |
| 🛡️ **安全纵深** | Bash 6 层防御、文件访问策略、设备路径拦截、交互式审批 |
| 🎯 **TypeScript** | 完整的类型推导和提示，极致开发体验 |
| 🖥️ **Web 控制台** | 实时监控、插件管理、日志查看 |

## 快速开始

### 环境要求

- **Node.js** 20.19.0+ 或 22.12.0+
- **pnpm** 9.0+（`npm install -g pnpm`）

### 创建项目

```bash
npm create zhin-app my-bot
cd my-bot
pnpm dev          # 开发模式（热重载）
```

脚手架会引导你选择运行时、数据库、聊天平台和 AI 提供商。

启动后可访问 Web 控制台：`http://localhost:8086`

> **Windows 用户** 📌：遇到问题请参考 [Windows 初始化指南](./docs/essentials/windows-setup.md)。

### 基础用法

```typescript
// src/plugins/hello.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打个招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)
```

在 `zhin.config.yml` 中启用插件：

```yaml
plugins:
  - hello
```

## 插件开发、测试与发布

Zhin.js 提供完整的插件开发工具链：

```bash
# 创建插件
npx zhin new my-plugin        # 交互式创建插件模板

# 开发调试
pnpm dev                      # 热重载开发，终端直接输入消息测试

# 测试
pnpm test                     # 运行 Vitest 单元测试
pnpm test:watch               # 监听模式
pnpm test:coverage            # 生成覆盖率报告

# 构建与发布
npx zhin build                # 构建插件
npx zhin pub                  # 发布到 npm
```

其他用户安装你发布的插件：

```bash
npx zhin search <keyword>     # 搜索插件
npx zhin install <name>       # 安装插件
npx zhin info <name>          # 查看插件信息
```

📖 完整指南：[插件开发、测试与发布](./docs/guide/plugin-development.md)

## AI 智能体

Zhin.js 内置 AI 智能体系统，让机器人具备大模型对话和工具调用能力：

```yaml
# zhin.config.yml
ai:
  enabled: true
  defaultProvider: ollama
  providers:
    ollama:
      host: "http://localhost:11434"
      # models 可省略 — ModelRegistry 自动发现并选择最优模型
  agent:
    chatModel: ''              # 留空自动选择（或指定如 qwen3:14b）
    visionModel: ''            # 留空自动选择视觉模型
    execSecurity: allowlist    # bash 执行策略：deny / allowlist / full
    execPreset: network        # 预设白名单：readonly / network / development
    execAsk: true              # 未知命令交互式审批
```

插件通过 `addTool` 注册 AI 可调用的工具：

```typescript
const { addTool } = usePlugin()

addTool({
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    city: { type: 'string', description: '城市名称', required: true }
  },
  execute: async ({ city }) => `${city}：晴，25°C`
})
```

### 文件化 AI 能力（零代码 / 轻代码）

除了上述程序化注册，还可以在约定目录放置 Markdown 文件，框架**自动发现并注册**，无需编写 TypeScript。

#### Tool（`*.tool.md`）

```text
tools/
├── greeting.tool.md          # 纯模板 Tool
└── weather/
    ├── weather.tool.md        # 带 handler 的 Tool
    └── handler.ts             # execute 逻辑
```

**纯模板示例**（`greeting.tool.md`）：

```markdown
---
name: greeting
description: 向用户问好
parameters:
  name:
    type: string
    description: 用户名称
    required: true
---
你好，{{name}}！欢迎使用 Zhin.js 🎉
```

> body 中的 `{{param}}` 会被参数值替换后直接作为返回。若需复杂逻辑，在 frontmatter 加 `handler: ./handler.ts`，指向一个默认导出函数。

#### Skill（`SKILL.md`）

```text
skills/
└── code-review/
    └── SKILL.md
```

```markdown
---
name: code-review
description: 代码审查助手
keywords: [review, lint, best-practice]
tags: [dev]
tools: [read_file, grep_search]
always: false          # true = 常驻注入；false = 按需激活
---
你是一个代码审查专家，请对用户提供的代码进行审查……
```

#### Agent 预设（`*.agent.md`）

```text
agents/
└── translator.agent.md
```

```markdown
---
name: translator
description: 多语翻译助手
model: gpt-4o
maxIterations: 5
tools: [web_search]
---
你是一名专业翻译，精通中英日三语互译……
```

#### 发现顺序

框架按 **`cwd/` → `~/.zhin/` → `data/` → 已加载插件包根** 的顺序扫描 `tools/`、`skills/`、`agents/` 目录，同名先发现者优先；工作区内的文件变更支持**热重载**。

📖 详见：[AI 模块](./docs/advanced/ai.md) · [工具与技能](./docs/advanced/tools-skills.md)

### 安全模型

AI 执行 bash 命令时受 **6 层纵深防御** 保护（参考 Claude Code 安全架构）：

| 层 | 防御 |
|----|------|
| 1 | 危险命令黑名单（`sudo`/`eval`/`dd` 等即使 full 模式也拦截） |
| 2 | 环境变量前缀剥离（`FOO=bar rm` → 识别为 `rm`） |
| 3 | Safe wrapper 剥离（`timeout 10 rm` → 识别为 `rm`） |
| 4 | 复合命令拆分（`ls && rm -rf /` → 逐段检查） |
| 5 | 只读命令自动放行（`cat`/`grep`/`ls` 无需白名单） |
| 6 | 交互式审批（`execAsk: true` 时用 `ask_user` 向用户确认） |

### AI 引擎架构

```
@zhin.js/ai（通用引擎，与 IM 无关）
├── Provider    — LLM 统一接口（OpenAI / Ollama / Anthropic / DeepSeek …）
├── Agent       — 多轮 tool-calling 循环
├── Memory      — 短期滑动窗口 + 长期链式摘要
├── CostTracker — Token 用量与成本追踪
├── FileStateCache / MicroCompact / ToolSearchCache — 性能优化层

@zhin.js/agent（IM 编排）
├── ExecPolicy    — 6 层 bash 安全
├── FilePolicy    — 文件访问策略与设备路径拦截
├── PromptBuilder — 10 段结构化系统提示词
├── 内置工具      — bash / read_file / ask_user / web_search …
└── 子任务 / 用户画像 / 定时跟进 / 引导文件
```

## 多平台适配器

| 平台 | 包名 | 平台 | 包名 |
|------|------|------|------|
| QQ (ICQQ) | `@zhin.js/adapter-icqq` | QQ 官方 | `@zhin.js/adapter-qq` |
| KOOK | `@zhin.js/adapter-kook` | Discord | `@zhin.js/adapter-discord` |
| Telegram | `@zhin.js/adapter-telegram` | Slack | `@zhin.js/adapter-slack` |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 飞书 | `@zhin.js/adapter-lark` |
| OneBot v11 | `@zhin.js/adapter-onebot11` | 微信公众号 | `@zhin.js/adapter-wechat-mp` |
| Sandbox | `@zhin.js/adapter-sandbox` | Email | `@zhin.js/adapter-email` |

## 常用命令

```bash
# 运行
pnpm dev                      # 开发模式（热重载）
pnpm start                    # 生产模式
pnpm start -- -d              # 后台守护进程
npx zhin stop                 # 停止后台进程

# 插件管理
npx zhin new <name>           # 创建插件模板
npx zhin build                # 构建插件
npx zhin pub                  # 发布插件到 npm
npx zhin search <keyword>     # 搜索 npm 上的 Zhin 插件
npx zhin install <name>       # 安装插件

# 诊断
npx zhin doctor               # 检查环境和配置
npx zhin setup                # 交互式配置向导
```

## 文档导航

| 分类 | 链接 |
|------|------|
| **入门** | [快速开始](./docs/getting-started/index.md) · [Docker 部署](./docs/getting-started/docker.md) · [Windows 环境](./docs/essentials/windows-setup.md) |
| **基础** | [核心概念](./docs/essentials/index.md) · [配置文件](./docs/essentials/configuration.md) · [命令系统](./docs/essentials/commands.md) · [插件系统](./docs/essentials/plugins.md) |
| **进阶** | [AI 模块](./docs/advanced/ai.md) · [Feature 系统](./docs/advanced/features.md) · [工具与技能](./docs/advanced/tools-skills.md) · [消息流转](./docs/essentials/message-flow.md) |
| **开发** | [插件开发指南](./docs/guide/plugin-development.md) · [贡献指南](./docs/contributing.md) · [架构概览](./docs/architecture-overview.md) · [API 参考](./docs/api/index.md) |

## 项目结构

```
zhin/
├── basic/            # 基础层（logger、database、schema、cli）
├── packages/         # 核心层
│   ├── kernel/       #   运行时内核（PluginBase、Feature、调度、错误体系）
│   ├── ai/           #   AI 引擎（Provider、Agent、Memory、CostTracker、缓存）
│   ├── core/         #   IM 框架（Plugin、Adapter、Bot、MessageDispatcher）
│   ├── agent/        #   Agent 编排（ExecPolicy、FilePolicy、PromptBuilder、内置工具）
│   ├── client/       #   Web 控制台（React Router 7、Redux）
│   └── zhin/         #   主入口包（统一导出）
├── plugins/          # 插件生态（adapters、services、utils）
├── docs/             # VitePress 文档站
└── examples/         # 示例项目
```

📖 详见：[仓库结构与模块化约定](./docs/contributing/repo-structure.md)

## 贡献者

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
pnpm dev
```

📖 详见：[贡献指南](./docs/contributing.md)

## 许可证

MIT License
