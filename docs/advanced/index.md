# 高级特性

深入了解 Zhin.js 的高级功能。

## AI 模块

集成大语言模型，让机器人具备智能对话和工具调用能力：

```yaml
# zhin.config.yml 中启用 AI
ai:
  enabled: true
  defaultProvider: ollama
  providers:
    ollama:
      baseURL: "http://localhost:11434"
      model: "qwen2.5:7b"
```

[了解更多 →](./ai)

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
