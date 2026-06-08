# 高级特性

深入了解 Zhin.js 的高级功能。

## AI 模块

集成大语言模型，让机器人具备智能对话和工具调用能力：

```yaml
# zhin.config.yml 中启用 AI
ai:
  providers:
    ollama:
      api: ollama-chat
      host: "http://127.0.0.1:11434"
      # models 可省略 — 自动 listModels
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
```

[了解更多 →](./ai)

## Agent 与 MCP

AI 原生能力的分层说明与 Advanced 开关：

- [Agent 概念入门](./agent-concepts) — `ctx.ai` / `ctx.agent`、Subagent、toolSearch
- [MCP 集成](./mcp) — Client 接外部工具 / Server 供 IDE 开发插件
- [Agent 安全与角色](./agent-harness-engineering) — 执行策略与七种编排角色
- [pi coding-agent 映射](./pi-coding-agent-mapping) — ADR 0010 能力对照表
- [Assistant Runtime 路线图](../architecture/assistant-runtime) — 个人助手（路线 A）：JobStore、事件入口、通知与智能家居领域层（Advanced / opt-in）
- [Assistant Event Ingress](./assistant-events) — `POST /api/assistant/events`：HA / 脚本触发 Agent Job（M2）
- [Assistant Home Domain](./assistant-home) — `home_*` 别名控灯、master 策略（M4）
- [HA × Zhin 接入清单](./assistant-home-setup) — 长期令牌、别名、第一次控灯（M4 验收）
- [Assistant Profile](./assistant-profile) — 单文件人格 / routines / 默认 notify（M5）

## Feature 系统

Feature 是 Zhin.js 的核心扩展机制，所有内置功能（命令、工具、定时任务等）均基于 Feature 实现：

```typescript
// CommandFeature、ToolFeature、SkillFeature、CronFeature...
// 每个 Feature 自动管理注册/注销、插件追踪、JSON 序列化
```

[了解更多 →](./features)

## 工具与技能

AI 工具（Tool）和技能（Skill）系统，为 AI 提供可调用的能力：

```typescript
const { addTool } = usePlugin()

addTool({
  name: 'get_weather',
  description: '查询天气',
  parameters: { city: { type: 'string', description: '城市名' } },
  execute: async ({ city }) => `${city}今天晴，25°C`
})
```

也可以通过文件声明，无需编写 TypeScript：

- **工具** — `tools/*.tool.md`（纯模板 `{{param}}` 或带 handler）
- **技能** — `skills/<name>/SKILL.md`（语义粗筛 + 工具列表）
- **Agent 预设** — `agents/*.agent.md`（领域专长子 Agent）

框架按 **`./tools`（或 `./skills` / `./agents`）→ `~/.zhin/<kind>/` → `.agents/skills/`（向上至 git 根）→ 已加载插件包内对应目录 → `zhin packages` 安装目录** 扫描（`data/skills` 已移除）；插件模块变更可热重载。

[了解更多 →](./tools-skills)

## 组件系统

使用组件复用消息模板：

```typescript
const UserCard = defineComponent((props) => {
  return `用户: ${props.name}`
}, 'UserCard')

addComponent(UserCard)
```

[了解更多 →](./components)

## 定时任务

使用 CronFeature 创建定时任务：

```typescript
const { addCron } = usePlugin()

addCron(new Cron('0 8 * * *', () => {
  console.log('早上好！')
}))
```

[了解更多 →](./cron)

## 数据库

使用 DatabaseFeature 存储数据：

```typescript
const { defineModel } = usePlugin()

defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'string' }
})
```

[了解更多 →](./database)

## 热重载

代码修改自动生效，无需重启：

- ✅ 插件代码修改
- ✅ 配置文件修改
- ✅ 依赖关系自动管理

[了解更多 →](./hot-reload)

## 更多

- [插件开发、测试与发布](/guide/plugin-development) — 从创建到发布的完整插件生命周期指南
