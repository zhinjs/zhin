# AI 模块

Zhin.js 内置 AI Agent 能力，可以对接大语言模型（LLM），让机器人具备智能对话、工具调用、上下文记忆等能力。

## 架构概览

```
用户消息 → MessageDispatcher → AI Handler → ZhinAgent
                                                ↓
                                     ┌──────────┴──────────┐
                                     │   收集工具（两级过滤）   │
                                     │   Skill → Tool       │
                                     └──────────┬──────────┘
                                                ↓
                                     ┌──────────┴──────────┐
                                     │   构建上下文           │
                                     │   历史 + 用户画像      │
                                     └──────────┬──────────┘
                                                ↓
                                     ┌──────────┴──────────┐
                                     │   路由处理             │
                                     │   纯对话 / 工具调用    │
                                     └──────────┬──────────┘
                                                ↓
                                           回复用户
```

核心组件：
- **ZhinAgent** - AI Agent 核心，编排 LLM 交互、工具选择和响应生成
- **Provider** - LLM 提供者抽象（Ollama、OpenAI 等）
- **SkillFeature** - 技能注册中心，管理所有 Skill
- **ToolFeature** - 工具注册中心，管理所有 Tool
- **MessageDispatcher** - 消息调度器，判断消息是否触发 AI

## 配置

在 `zhin.config.yml` 中配置 AI 模块：

```yaml
ai:
  enabled: true
  defaultProvider: ollama
  
  # LLM 提供者
  providers:
    ollama:
      baseURL: "http://localhost:11434"
      model: "qwen2.5:7b"
    openai:
      apiKey: "${OPENAI_API_KEY}"
      baseURL: "https://api.openai.com/v1"
      model: "gpt-4o-mini"
  
  # 会话管理
  sessions:
    useDatabase: true        # 使用数据库持久化
    maxHistory: 20           # 每个会话最大历史消息数
    expireMs: 3600000        # 会话过期时间（1 小时）
  
  # 上下文管理
  context:
    maxMessagesBeforeSummary: 10   # 触发自动摘要的消息数
    summaryRetentionDays: 30      # 摘要保留天数
  
  # 触发条件
  trigger:
    respondToAt: true        # @机器人 时触发
    respondToPrivate: true   # 私聊时触发
    prefixes: ["ai "]        # 消息前缀触发
    ignorePrefixes: ["/", "!"]  # 忽略这些前缀（命令前缀）
    timeout: 60000           # 处理超时（毫秒）
```

## 触发条件

AI 不会处理所有消息。只有满足以下条件之一时才会触发：

1. **@机器人** - 在群聊中 @机器人（需 `respondToAt: true`）
2. **私聊** - 直接发私聊消息（需 `respondToPrivate: true`）
3. **前缀触发** - 消息以指定前缀开头（如 `ai 今天天气怎样`）

同时，以下消息会被排除：
- 以 `ignorePrefixes` 中的前缀开头的消息（通常是命令，如 `/help`）
- 已被命令系统匹配到的消息

## 消息处理流程

### 1. 工具收集（两级过滤）

AI 收到消息后，首先收集可用的工具：

**第一级：Skill 粗筛**
- 根据用户消息关键词匹配相关的 Skill
- 例如用户说"禁言那个人"，匹配到 ICQQ 群管理 Skill

**第二级：Tool 细筛**
- 从匹配到的 Skill 中取出工具
- 根据发送者权限过滤（普通用户看不到管理员工具）
- 根据相关性评分排序

### 2. 上下文构建

AI 会构建包含以下信息的上下文：
- 人格设定（systemPrompt）
- 当前上下文信息（Bot ID、平台、发送者、权限、场景等）
- 历史对话记录
- 用户画像（AI 对用户的理解）

### 3. 路由处理

根据是否有可用工具，走不同路径：
- **无工具** -> 纯对话模式，直接与 LLM 对话
- **有工具** -> Agent 模式，LLM 可以选择调用工具或直接回复

### 4. 工具调用

当 LLM 决定调用工具时：
1. LLM 输出工具名称和参数
2. ZhinAgent 执行工具（注入 ToolContext 用于权限校验）
3. 工具结果返回给 LLM
4. LLM 生成最终回复

## 会话管理

AI 为每个场景（群/私聊）维护独立的会话历史。

### 自动摘要

当对话消息数超过阈值时，AI 会自动生成对话摘要，压缩历史上下文：

```
第 1-10 轮对话 → 生成摘要 A
第 11-20 轮对话 → 生成摘要 B（包含摘要 A 的引用）
```

摘要机制确保长对话不会导致 token 爆炸，同时保留关键上下文。

### 用户画像

AI 会逐步建立对每个用户的理解（兴趣、偏好、交流风格等），存储在用户画像中，让对话更加个性化。

## 工具系统

详见 [工具与技能](/advanced/tools-skills)。

### 注册工具

```typescript
const { addTool } = usePlugin()

addTool({
  name: 'search_music',
  description: '搜索音乐',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
    },
    required: ['keyword'],
  },
  execute: async (args) => {
    return await searchMusic(args.keyword)
  },
})
```

### 声明技能

```typescript
const { declareSkill } = usePlugin()

declareSkill({
  description: '音乐搜索和播放服务',
  keywords: ['音乐', '歌', '播放', '听'],
  tags: ['music', '娱乐'],
})
```

## 权限控制

工具可以设置权限级别，AI Agent 会根据发送者权限自动过滤：

| 级别 | 说明 | 数值 |
|------|------|------|
| `user` | 普通用户（所有人） | 0 |
| `group_admin` | 群管理员 | 1 |
| `group_owner` | 群主 | 2 |
| `bot_admin` | 机器人管理员 | 3 |
| `owner` | 机器人拥有者 | 4 |

工具执行时还会进行运行时权限二次校验，确保安全。

## 自定义 Provider

AI 支持自定义 LLM 提供者。只要兼容 OpenAI Chat Completions API 格式，就可以接入：

```yaml
ai:
  providers:
    my-local:
      baseURL: "http://my-server:8000/v1"
      model: "my-model"
      apiKey: "optional-key"
```

## 流式输出

当适配器支持时，AI 会以流式方式输出响应，提升用户体验。通过 `onChunk` 回调实现实时推送。

## 多模态支持

AI 支持图片+文本的多模态输入（需要 LLM 支持视觉能力）：

```typescript
agent.processMultimodal(
  [
    { type: 'text', text: '这是什么？' },
    { type: 'image_url', image_url: { url: 'https://...' } },
  ],
  context
)
```
