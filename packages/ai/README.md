# @zhin.js/ai

🤖 Zhin.js AI 服务插件 - 多模型 LLM 集成与 Agent 能力

## ✨ 特性

- 🔌 **多模型支持**：OpenAI、Claude、DeepSeek、Moonshot、智谱、Ollama
- 🔄 **流式输出**：实时响应，提升用户体验
- 🛠️ **工具调用**：Function Calling / Tool Use 支持
- 🤖 **Agent 能力**：自动规划、工具调用、多轮推理
- 💬 **会话管理**：上下文记忆、自动过期、持久化
- 📝 **内置工具**：计算器、时间、HTTP 请求等
- 💾 **数据库持久化**：自动使用 Zhin 数据库存储会话，支持更长记忆
- 📊 **消息记录**：自动记录所有平台消息，构建智能上下文
- 🧠 **智能总结**：自动总结历史对话，保持上下文简洁
- 🎯 **AI 触发中间件**：支持 @机器人、前缀触发、私聊直接对话
- 🔧 **统一工具服务**：Tool ↔ Command 双向转换，AI 可调用现有命令
- 🎨 **富媒体支持**：AI 可输出图片、音频、视频、@用户等富媒体内容
- 🔒 **权限控制**：基于平台、场景、用户权限的工具过滤

## 📦 安装

```bash
pnpm add @zhin.js/ai
```

## 🚀 快速开始

### 1. 配置

在 `zhin.config.yml` 中添加配置：

```yaml
ai:
  enabled: true
  defaultProvider: openai
  providers:
    openai:
      apiKey: sk-xxx
      # baseUrl: https://api.openai.com/v1  # 可选，自定义 API 地址
    anthropic:
      apiKey: sk-ant-xxx
    deepseek:
      apiKey: sk-xxx
    moonshot:
      apiKey: sk-xxx  # 月之暗面 API Key
    zhipu:
      apiKey: sk-xxx  # 智谱 AI API Key
    ollama:
      baseUrl: http://localhost:11434  # 本地 Ollama 服务
  sessions:
    maxHistory: 200        # 最大历史消息数（数据库模式默认200）
    expireMs: 604800000    # 会话过期时间（7天）
    useDatabase: true      # 使用数据库持久化（默认开启）
  context:
    enabled: true          # 启用消息记录和智能上下文
    maxRecentMessages: 100 # 读取最近消息数量
    summaryThreshold: 50   # 触发自动总结的消息数量
    keepAfterSummary: 10   # 总结后保留的最近消息数
    maxContextTokens: 4000 # 上下文最大 token 估算
```

### 2. 启用插件

```yaml
plugins:
  - ai
```

## 📊 消息记录与智能上下文

AI 插件会自动记录所有平台的聊天消息，并在对话时智能构建上下文。

### 消息记录格式

所有消息自动保存到 `chat_messages` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| platform | text | 平台标识：icqq, kook, discord 等 |
| scene_id | text | 场景ID：群号/频道ID/用户ID |
| scene_type | text | 场景类型：group, private, channel |
| scene_name | text | 场景名称 |
| sender_id | text | 发送者ID |
| sender_name | text | 发送者名称 |
| message | text | 消息内容 |
| time | integer | 时间戳（毫秒） |

### 智能上下文

当使用 `/chat` 命令时：

1. **自动读取历史**：读取当前场景最近 100 条消息
2. **包含历史总结**：如果有之前的总结，会作为背景信息
3. **理解多人对话**：AI 能区分不同用户的发言
4. **自动总结**：当消息过多时自动总结，保持上下文简洁

### 配置选项

```yaml
ai:
  context:
    enabled: true           # 启用消息记录（默认开启）
    maxRecentMessages: 100  # 读取最近消息数量
    summaryThreshold: 50    # 超过此数量触发自动总结
    keepAfterSummary: 10    # 总结后保留最近几条消息
    maxContextTokens: 4000  # 上下文最大 token（估算）
```

## 💾 会话持久化

AI 插件默认使用 Zhin 的数据库服务进行会话持久化存储，提供以下优势：

### 优势

- **更长的记忆能力**：数据库模式默认保存 200 条消息历史（内存模式 100 条）
- **持久化存储**：机器人重启后会话不丢失
- **更长的过期时间**：数据库模式默认 7 天过期（内存模式 24 小时）
- **自动切换**：数据库就绪时自动从内存切换到数据库存储

### 配置选项

```yaml
ai:
  sessions:
    # 最大历史消息数
    # 数据库模式默认 200，内存模式默认 100
    maxHistory: 200
    
    # 会话过期时间（毫秒）
    # 数据库模式默认 7 天，内存模式默认 24 小时
    expireMs: 604800000
    
    # 是否使用数据库持久化
    # 默认 true，设为 false 使用内存存储
    useDatabase: true
```

### 数据库模型

会话数据存储在 `ai_sessions` 表中：

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | text | 会话 ID（平台:用户ID 或 平台:频道ID:用户ID） |
| `messages` | json | 消息历史 |
| `config` | json | 会话配置 |
| `created_at` | integer | 创建时间戳 |
| `updated_at` | integer | 更新时间戳 |

## 🎯 AI 触发方式

AI 插件提供独立的触发中间件，支持多种触发方式：

### 触发配置

```yaml
ai:
  trigger:
    enabled: true
    prefixes:              # 前缀触发
      - '#'
      - 'AI:'
      - 'ai:'
    respondToAt: true      # @机器人触发
    respondToPrivate: true # 私聊直接对话
    ignorePrefixes:        # 忽略的前缀（避免与命令冲突）
      - '/'
      - '!'
    timeout: 60000         # 超时时间
    # thinkingMessage: '🤔 思考中...'  # 可选提示
```

### 使用示例

```
# 使用 # 前缀触发
# 今天天气怎么样？

# @机器人触发（群聊）
@机器人 帮我计算 2+3*4

# 私聊直接对话
北京今天适合出门吗？
```

## 💬 使用命令

插件提供以下命令：

| 命令 | 描述 | 示例 |
|------|------|------|
| `/ai.models` | 列出可用模型 | `/ai.models` |
| `/ai.clear` | 清除对话历史 | `/ai.clear` |
| `/ai.stats` | 查看场景消息统计 | `/ai.stats` |
| `/ai.tools` | 列出所有可用工具 | `/ai.tools` |
| `/ai.summary` | 生成对话总结 | `/ai.summary` |
| `/ai.health` | 检查 AI 服务健康状态 | `/ai.health` |

### /chat 命令详解

`/chat` 命令会自动读取当前场景（群聊/私聊）的最近 100 条消息作为上下文：

```
# 基本对话（AI 能看到之前的群聊记录）
/chat 刚才大家在讨论什么？

# 开始新对话（清除上下文）
/chat -n 你好，我们重新开始

# 手动总结历史（生成摘要）
/chat -s
```

### 指定模型和提供商

```
/ask -m gpt-4o -p openai 解释相对论
/ask -m claude-opus-4-20250514 -p anthropic 写一首诗
```

## 🔧 编程接口

### 基础使用

```typescript
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();

// 获取 AI 服务
plugin.useContext('ai', async (ai) => {
  // 简单问答
  const answer = await ai.ask('什么是 TypeScript?');
  console.log(answer);

  // 指定模型
  const answer2 = await ai.ask('写一首诗', {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    temperature: 0.9,
  });
});
```

### 会话聊天

```typescript
plugin.useContext('ai', async (ai) => {
  const sessionId = 'user-123';

  // 多轮对话
  await ai.chatWithSession(sessionId, '我叫小明');
  const response = await ai.chatWithSession(sessionId, '我叫什么？');
  // response: "你叫小明"

  // 流式响应
  const stream = await ai.chatWithSession(sessionId, '讲个故事', { stream: true });
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
});
```

### 使用 Agent

```typescript
plugin.useContext('ai', async (ai) => {
  // 使用内置工具
  const result = await ai.runAgent('计算 sin(45°) 的值');
  console.log(result.content);
  console.log('使用的工具:', result.toolCalls);

  // 自定义工具
  const agent = ai.createAgent({
    model: 'gpt-4o',
    tools: [{
      name: 'search_database',
      description: '搜索数据库',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      },
      async execute(args) {
        // 实现搜索逻辑
        return { results: ['结果1', '结果2'] };
      }
    }]
  });

  const result2 = await agent.run('搜索用户张三的信息');
});
```

### 流式 Agent

```typescript
plugin.useContext('ai', async (ai) => {
  const agent = ai.createAgent({ model: 'gpt-4o' });

  for await (const event of agent.runStream('查询当前时间并计算距离新年还有多少天')) {
    switch (event.type) {
      case 'content':
        process.stdout.write(event.data);
        break;
      case 'tool_call':
        console.log(`\n调用工具: ${event.data.name}`);
        break;
      case 'tool_result':
        console.log(`工具结果: ${event.data.result}`);
        break;
      case 'done':
        console.log('\n完成:', event.data.usage);
        break;
    }
  }
});
```

## 🛠️ 内置工具

| 工具 | 描述 |
|------|------|
| `calculator` | 数学计算（支持三角函数、对数等） |
| `get_time` | 获取当前时间 |
| `get_weather` | 获取天气（模拟数据） |
| `web_search` | 网页搜索（需要配置 API） |
| `http_request` | HTTP 请求 |
| `run_code` | 执行 JavaScript 代码 |

### 添加自定义工具

```typescript
import { createCalculatorTool, createTimeTool } from '@zhin.js/ai';

const myTool = {
  name: 'my_tool',
  description: '我的自定义工具',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    }
  },
  async execute(args) {
    return `处理结果: ${args.input}`;
  }
};

const agent = ai.createAgent({
  tools: [myTool],
  useBuiltinTools: true, // 同时使用内置工具
});
```

## 🔧 统一工具服务

AI 插件提供统一的工具服务，支持 Tool ↔ Command 双向转换：

### 使用 ZhinTool 类（推荐）

```typescript
import { usePlugin, ZhinTool } from 'zhin.js';

const plugin = usePlugin();

// 使用链式调用定义工具
const weatherTool = new ZhinTool('weather')
  .desc('查询天气信息')
  .param('city', { type: 'string', description: '城市名称' }, true)
  .param('days', { type: 'number', description: '预报天数' })
  .platform('qq', 'telegram')  // 限定平台
  .scope('group', 'private')   // 限定场景
  .permission('user')          // 权限级别
  // AI 调用时执行
  .execute(async (args, ctx) => {
    return `${args.city} 的天气是晴天`;
  })
  // 可选：生成命令（与 MessageCommand.action 一致）
  .action(async (message, result) => {
    return `天气查询: ${result.params.city}`;
  });

plugin.addTool(weatherTool);
```

### 使用 defineTool 辅助函数

```typescript
import { usePlugin, defineTool } from 'zhin.js';

const plugin = usePlugin();

const calculatorTool = defineTool<{ expression: string }>({
  name: 'calculator',
  description: '计算数学表达式',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式',
      },
    },
    required: ['expression'],
  },
  // 可选：命令配置
  command: {
    pattern: 'calc <expression:rest>',
    alias: ['计算'],
    usage: ['计算数学表达式'],
  },
  execute: async (args) => {
    // args.expression 有完整类型提示
    const result = eval(args.expression);
    return `结果: ${result}`;
  },
});

plugin.addTool(calculatorTool);
```

### 权限控制

工具可以声明权限要求：

```typescript
const adminTool = new ZhinTool('admin_action')
  .desc('管理员操作')
  .permission('bot_admin')  // 需要机器人管理员权限
  .scope('group')           // 仅在群聊可用
  .execute(async (args) => {
    return '操作成功';
  });
```

权限级别（从低到高）：
- `user` - 普通用户
- `group_admin` - 群管理员
- `group_owner` - 群主
- `bot_admin` - 机器人管理员
- `owner` - Zhin 拥有者

## 🎨 富媒体输出

AI 可以输出富媒体内容，使用 XML-like 标签格式：

```
# AI 可以在回复中使用：

<image url="https://example.com/cat.jpg"/>   # 图片
<video url="https://example.com/video.mp4"/> # 视频
<audio url="https://example.com/song.mp3"/>  # 音频
<at user_id="123456"/>                       # @用户
<face id="178"/>                             # 表情

# 混合使用
今天天气不错！<image url="https://weather.com/sunny.jpg"/>
```

系统会自动将这些标签解析为平台对应的消息元素

## 🔌 支持的模型

### OpenAI
- gpt-4o, gpt-4o-mini
- gpt-4-turbo, gpt-4
- gpt-3.5-turbo
- o1, o1-mini, o1-preview, o3-mini

### Anthropic (Claude)
- claude-opus-4-20250514
- claude-sonnet-4-20250514
- claude-3-7-sonnet-20250219
- claude-3-5-sonnet-20241022
- claude-3-5-haiku-20241022

### DeepSeek
- deepseek-chat
- deepseek-coder
- deepseek-reasoner

### Moonshot (月之暗面)
- moonshot-v1-8k
- moonshot-v1-32k
- moonshot-v1-128k

### 智谱 AI
- glm-4-plus, glm-4
- glm-4-air, glm-4-flash
- glm-4v-plus

### Ollama (本地)
- llama3.3, llama3.2, llama3.1
- qwen2.5, qwen2.5-coder
- deepseek-r1, deepseek-v3
- mistral, mixtral
- phi4, gemma2

## 📚 类型扩展

```typescript
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      ai: import('@zhin.js/ai').AIService;
    }
  }
}
```

## 🔗 与 MCP 集成

AI 服务可以与 MCP (Model Context Protocol) 无缝集成：

```typescript
// MCP 工具可以调用 AI 服务
server.registerTool('ai_chat', {
  description: '与 AI 对话',
  inputSchema: z.object({
    message: z.string(),
  }),
}, async (args) => {
  const ai = plugin.inject('ai');
  const response = await ai.ask(args.message);
  return { content: [{ type: 'text', text: response }] };
});
```

## ⚙️ 高级配置

### 使用代理

```yaml
ai:
  providers:
    openai:
      apiKey: sk-xxx
      baseUrl: https://your-proxy.com/v1
```

### 自定义 Provider

```typescript
import { OpenAIProvider } from '@zhin.js/ai';

// 创建自定义 provider
const customProvider = new OpenAIProvider({
  apiKey: 'xxx',
  baseUrl: 'https://api.custom.com/v1',
  headers: {
    'X-Custom-Header': 'value'
  }
});

ai.registerProvider(customProvider);
```

## 📄 License

MIT
