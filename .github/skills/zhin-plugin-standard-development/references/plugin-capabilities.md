# 插件能力地图

这个参考文件回答两个问题：

1. Zhin 插件除了命令、中间件、数据库、Web，还能做什么。
2. 某个能力应该放进普通插件，还是应该切去别的工作流。

## 能力总览

### 命令

- 入口：`addCommand(new MessageCommand(...))`
- 适用：聊天指令、参数解析、权限入口
- 典型场景：用户主动触发的业务能力

### 中间件

- 入口：`addMiddleware(async (message, next) => { ... })`
- 适用：消息流的前后置处理、过滤、统计、拦截
- 典型场景：不依赖显式命令触发的消息处理

### 事件监听

- 入口：`plugin.on('message.receive', ...)`
- 常见事件：`message.receive`、`message.private.receive`、`message.group.receive`、`before.sendMessage`
- 适用：入站观察、发送前改写、插件生命周期联动

### 定时任务

- 入口：`addCron(new Cron(expression, callback))`
- 适用：周期同步、定时报表、过期清理、轮询外部资源
- 真实来源：RSS 插件、group-daily-analysis 插件

### 组件

- 入口：`defineComponent(...)` + `addComponent(...)`
- 适用：可复用消息片段、异步消息渲染、JSX 组合输出
- 真实来源：music、html-renderer、test-jsx

### Context / 服务

- 入口：`provide(...)`、`useContext(...)`、`inject(...)`
- 适用：依赖注入、资源装配、服务注册、生命周期管理
- 适合放：数据库接入、外部 SDK、HTTP 路由、共享服务

### 配置 Schema

- 入口：`declareConfig(key, Schema.object(...))`
- 适用：声明插件配置及默认值，供配置系统和控制台使用
- 真实来源：rss、stats、http 等插件

### 数据模型

- 入口：`defineModel(...)` 或 `db.define(...)`
- 适用：持久化表结构和插件数据访问
- 适合配合：`useContext('database', ...)`

### Web / Console 集成

- 入口：`useContext('router', ...)`、`useContext('web', ...)`
- 适用：HTTP API、WebSocket、控制台前端入口挂载
- 适合配合：`client/index.tsx` 页面文件

### AI 工具

- 入口（程序化）：`addTool(new ZhinTool(...))`
- 入口（文件化）：`tools/<name>.tool.md` 或 `tools/<name>/<name>.tool.md`（框架自动发现）
- 适用：给 AI 暴露结构化可调用能力
- 文件化 Tool 支持纯模板（body 中 `{{param}}` 替换）或带 handler 文件
- 程序化注册的同名 Tool 优先于文件化版本
- 真实来源：stats、60s、test-bot 工具示例

### AI 技能（Skill）

- 入口：标准 `skills/<name>/SKILL.md` 文件（框架自动发现）
- 适用：将多个 Tool 逻辑分组，配合 SKILL.md 提供按需加载的指令内容
- Frontmatter 字段：name, description, keywords, tags, tools, always
- `always: true` 时技能指令常驻注入 system prompt

### AI Agent 预设

- 入口：标准 `agents/<name>.agent.md` 文件（框架自动发现）
- 适用：声明领域专长 Agent，主 Agent 可自动识别并委派
- Frontmatter 字段：name, description, tools, model, provider, maxIterations 等
- Body 部分作为 systemPrompt 注入

## 选择建议

### 用户主动输入一句话触发

优先考虑命令。

### 每条消息都可能触发

优先考虑中间件或事件监听。

### 需要周期执行

优先考虑定时任务，不要手写 `setInterval` 代替 `Cron`。

### 需要复用消息渲染片段

优先考虑组件，而不是在多个命令里复制字符串拼接逻辑。

### 需要共享依赖或资源生命周期

优先考虑 Context / 服务。

### 需要持久化

优先建模，再接数据库服务。

### 需要控制台页面或 HTTP API

优先走 `router` / `web` 集成，而不是把页面逻辑塞进命令里。

### 需要给 AI 暴露工具能力

优先用 `addTool()`，不要强行把 AI 工具包装成普通命令。

### 需要把多个 AI 工具分组

用 `skills/<name>/SKILL.md` 文件提供技能定义，框架自动发现。

### 需要声明领域专长 Agent

用 `agents/<name>.agent.md` 文件声明 Agent 预设，框架自动发现，不要在插件里自行创建独立的 AI 会话。

## 何时不该继续走本 skill

出现以下特征时，应切换工作流：

- 需要实现 Bot 类、连接平台网关、消息格式转换：切到适配器工作流
- 主要任务是调整 monorepo 边界、消息链路或依赖方向：切到架构优化工作流
- 主要任务是控制台页面视觉和 React 结构优化：切到前端优化工作流