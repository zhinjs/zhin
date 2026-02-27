# AI 模块

Zhin.js 内置 AI Agent 能力，可以对接大语言模型（LLM），让机器人具备智能对话、工具调用、上下文记忆等能力。

## 目录

- [架构概览](#架构概览)
- [配置](#配置)
- [Agent 配置详解](#agent-配置详解)
- [触发条件](#触发条件)
- [消息处理流程](#消息处理流程)
- [会话管理](#会话管理)
- [工具与技能](#工具与技能)
- [子任务 (Subagent)](#子任务-subagent)
- [定时消息 (Follow-up)](#定时消息-follow-up)
- [用户画像](#用户画像)
- [对话记忆](#对话记忆)
- [Hook 系统](#hook-系统)
- [会话压缩](#会话压缩)
- [Bootstrap 引导文件](#bootstrap-引导文件)
- [输出解析](#输出解析)
- [权限控制](#权限控制)
- [执行安全 (execSecurity)](#执行安全-execsecurity)
- [Provider 统一抽象](#provider-统一抽象)
- [小模型适配](#小模型适配)
- [流式输出](#流式输出)
- [多模态支持](#多模态支持)
- [自定义 Provider](#自定义-provider)

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
                                     │   ↕ Subagent / Cron  │
                                     └──────────┬──────────┘
                                                ↓
                                           回复用户
```

核心组件：
- **ZhinAgent** - AI Agent 核心，编排 LLM 交互、工具选择和响应生成
- **Provider** - LLM 提供者抽象（Ollama、OpenAI、Anthropic 等），统一 `contextWindow` / `capabilities`
- **SkillFeature** - 技能注册中心，管理所有 Skill
- **ToolFeature** - 工具注册中心，管理所有 Tool
- **MessageDispatcher** - 消息调度器，判断消息是否触发 AI
- **SubagentManager** - 后台子任务管理器，执行复杂异步任务
- **FollowUpManager** - 定时跟进提醒管理器
- **ConversationMemory** - 对话记忆，主题检测 + 链式摘要
- **UserProfileStore** - 用户画像，跨会话个性化

## 配置

在 `zhin.config.yml` 中配置 AI 模块：

```yaml
ai:
  enabled: true
  defaultProvider: ollama
  
  providers:
    ollama:
      host: "http://localhost:11434"
      models:
        - qwen3:14b
      num_ctx: 32768          # 上下文窗口（token 数）
      contextWindow: 32768    # 通用字段，优先级高于 num_ctx
    openai:
      apiKey: "${OPENAI_API_KEY}"
      contextWindow: 128000
  
  sessions:
    useDatabase: true
    maxHistory: 50
    expireMs: 3600000
  
  context:
    enabled: true
    maxMessagesBeforeSummary: 100
    summaryRetentionDays: 30
  
  agent:
    execSecurity: allowlist
    execPreset: network       # readonly / network / development / custom
    execAllowlist:            # 与 preset 合并
      - "curl"
    maxIterations: 5
    contextTokens: 128000
    maxHistoryShare: 0.5
    toneAwareness: true
    modelSizeHint: medium     # small / medium / large（留空自动推断）
    maxSubagentIterations: 15
  
  trigger:
    enabled: true
    prefixes: ["#", "AI:"]
    respondToAt: true
    respondToPrivate: true
    ignorePrefixes: ["/", "!"]
    timeout: 60000
```

## Agent 配置详解

`ai.agent` 下的完整配置项：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxIterations` | number | 5 | 最大工具调用轮数，技能激活时自动 +3 |
| `timeout` | number | 60000 | 单次请求超时（ms） |
| `preExecTimeout` | number | 10000 | 预执行超时（ms） |
| `maxSkills` | number | 3 | 单次请求最多匹配的 Skill 数量 |
| `maxTools` | number | 8 | 单次请求最多下发的工具数量 |
| `contextTokens` | number | 128000 | 上下文窗口 token 数 |
| `maxHistoryShare` | number | 0.5 | 历史记录占上下文窗口的最大比例 |
| `toneAwareness` | boolean | true | 是否启用情绪感知 |
| `visionModel` | string | '' | 视觉模型名称（如 llava） |
| `execSecurity` | string | 'deny' | bash 执行策略：deny / allowlist / full |
| `execPreset` | string | 'custom' | 预设命令白名单：readonly / network / development / custom |
| `execAllowlist` | string[] | [] | 自定义允许的命令（正则字符串） |
| `execAsk` | boolean | false | 未匹配命令是否提示审批 |
| `disabledTools` | string[] | [] | 禁用的工具列表 |
| `allowedTools` | string[] | [] | 仅允许的工具列表（优先于 disabledTools） |
| `rateLimit` | object | {} | 速率限制配置 |
| `modelSizeHint` | string | '' | 模型大小提示（影响技能截断） |
| `skillInstructionMaxChars` | number | 0 | 技能指令最大字符数（覆盖自动推断） |
| `maxSubagentIterations` | number | 15 | 子 agent 最大工具调用轮数 |
| `subagentTools` | string[] | [] | 子 agent 允许使用的工具名列表 |

## 触发条件

AI 不会处理所有消息。只有满足以下条件之一时才会触发：

1. **@机器人** - 在群聊中 @机器人（需 `respondToAt: true`）
2. **私聊** - 直接发私聊消息（需 `respondToPrivate: true`）
3. **前缀触发** - 消息以指定前缀开头（如 `#今天天气怎样`）

以下消息会被排除：
- 以 `ignorePrefixes` 中的前缀开头的消息（通常是命令）
- 已被命令系统匹配到的消息

## 消息处理流程

### 1. 工具收集（两级过滤）

**第一级：Skill 粗筛** — 根据用户消息关键词匹配相关的 Skill。

**第二级：Tool 细筛** — 从匹配到的 Skill 中取出工具，按权限过滤、按相关性评分排序。

### 2. 上下文构建

构建上下文包括：人格设定、当前场景信息、历史对话记录、用户画像。历史记录经过 token 预算修剪，确保不超出上下文窗口。

### 3. 路由处理

- **无工具（闲聊路径）** → 纯对话模式，轻量 prompt + 流式 1 次 LLM 调用
- **全预执行工具（快速路径）** → 预执行结果注入 prompt → 1 次 LLM
- **有参数工具（Agent 路径）** → 多轮 LLM tool-calling

### 4. 自适应 maxIterations

当检测到 `activate_skill` 或 `install_skill` 在工具列表中时，自动将 `maxIterations` 增加 3，避免多步技能流程被提前截断。

## 会话管理

AI 为每个场景（群/私聊）维护独立的会话历史，支持内存模式和数据库持久化模式。

### 自动摘要

当对话消息数超过阈值时，AI 自动生成链式摘要：

```
第 1-10 轮对话 → 摘要 A
第 11-20 轮对话 → 摘要 B（包含摘要 A 引用）
```

## 工具与技能

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

### 安装外部技能 (install_skill)

AI 可以从 URL 下载 `SKILL.md` 并安装到本地 `skills/` 目录。用户只需说"从 https://example.com/skill.md 安装技能"，AI 会自动调用 `install_skill` 下载并安装，然后用 `activate_skill` 激活。

### SKILL.md 编写指南

建议 SKILL.md 添加 `## 快速操作` 摘要段，供小模型优先使用：

```markdown
---
name: my-skill
description: 我的技能
tools:
  - web_fetch
  - write_file
---

# My Skill

## 快速操作
1. 调用 web_fetch 获取数据
2. 调用 write_file 保存结果

## 详细说明
...
```

### 技能热重载

工作区 `skills/` 目录支持 `fs.watch` 监控。新增或修改 SKILL.md 后，技能列表会自动更新，无需重启。

## 子任务 (Subagent)

`spawn_task` 工具允许 AI 将复杂或耗时的任务交给后台子 agent 异步处理。

### 工作原理

1. 主 agent 调用 `spawn_task(task, label)`
2. `SubagentManager` 创建独立的子 agent，配备受限工具集
3. 子 agent 独立执行，不阻塞主对话
4. 完成后通过 `resultSender` 回调将结果发送到原始频道

### 受限工具集

子 agent 只能使用以下工具：`read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`, `bash`, `web_search`, `web_fetch`。

**安全**：子 agent 的 `bash` 工具同样受 `execSecurity` 策略约束，不会绕过安全检查。

### 触发关键词

当用户消息包含"后台"、"子任务"、"spawn"、"异步"、"background"、"并行"、"独立处理"时，`spawn_task` 工具会被注入。

## 定时消息 (Follow-up)

`schedule_followup` 工具允许 AI 安排定时跟进提醒。

### 特性

- **持久化**：任务保存到数据库，重启不丢失
- **自动恢复**：启动时调用 `restoreFollowUps()` 恢复未完成的任务
- **自动取消**：同一会话创建新提醒时，旧的 pending 提醒自动取消
- **触发关键词**：提醒、定时、过一会、跟进、别忘、分钟后、小时后

### 示例

用户说"3分钟后提醒我喝水"，AI 调用：

```json
{ "action": "create", "delay_minutes": 3, "message": "该喝水啦！" }
```

## 用户画像

`user_profile` 工具让 AI 读写用户的个人偏好信息。

### 操作

- `get` — 读取用户所有偏好
- `set(key, value)` — 保存偏好（如 name, style, interests, timezone）
- `delete(key)` — 删除偏好

### 持久化

默认内存存储，调用 `upgradeProfilesToDatabase(model)` 后升级为数据库存储，实现跨会话个性化。

画像会被注入到系统 prompt 中（通过 `buildProfileSummary`），让 AI 在每次对话中都能感知用户偏好。

## 对话记忆

`ConversationMemory` 管理双层记忆：

### 短期记忆

滑动窗口保留最近 N 轮消息（默认 5），确保上下文连贯。

### 长期记忆（链式摘要）

当话题持续超过 `minTopicRounds` 轮时触发摘要。使用主题检测（`topicChangeThreshold`）判断话题边界，不同话题分别生成摘要。

### chat_history 工具

当用户消息包含"之前"、"上次"、"历史"、"回忆"等关键词时，`chat_history` 工具被注入，支持：
- 按关键词搜索历史记录
- 按轮次范围查询
- 无参数返回最近几轮

## Hook 系统

AI 模块提供事件钩子，允许插件监听和响应 AI 行为。

### 事件类型

| 事件 | 触发时机 |
|------|---------|
| `message:received` | AI 收到用户消息时 |
| `message:sent` | AI 发送回复时 |
| `session:compact` | 会话压缩时 |
| `session:new` | 新会话创建时 |
| `agent:bootstrap` | Agent 初始化时 |
| `tool:call` | 工具被调用时 |

### 注册方式

```typescript
import { registerAIHook } from '@zhin.js/core'

registerAIHook('message:received', async (event) => {
  console.log(`用户 ${event.data.userId} 说: ${event.data.content}`)
})
```

## 会话压缩

`compactSession` 模块管理上下文窗口，防止 token 超限。

### 策略

1. **Token 预算**：`contextTokens`（默认 128000）定义总上下文窗口大小
2. **历史占比**：`maxHistoryShare`（默认 0.5）限制历史消息最多占用 50% 的窗口
3. **自动修剪**：`pruneHistoryForContext` 从最旧的消息开始丢弃，直到符合预算
4. **分阶段摘要**：`summarizeInStages` 对超长历史进行分块摘要

### 上下文窗口守卫

```typescript
const guard = evaluateContextWindowGuard({
  messages: historyMessages,
  maxContextTokens: 128000,
  maxHistoryShare: 0.5,
})
// guard.status: 'ok' | 'warning' | 'critical'
```

## Bootstrap 引导文件

项目根目录或 `data/` 下可放置引导文件，按 **SOUL → AGENTS → TOOLS** 顺序注入到 system prompt：

| 文件 | 用途 | 大小限制 |
|------|------|---------|
| **SOUL.md** | 人格与边界：性格、价值观、沟通风格。只读。 | 约 8KB |
| **AGENTS.md** | 记忆与操作指南：用户偏好、重要记录、待办。AI 可读写。 | 约 16KB |
| **TOOLS.md** | 工具使用指引：自定义工具使用规则与注意事项。 | 约 8KB |

- 文件不存在不报错；单文件与总长度有上限，超长会截断
- `clearBootstrapCache()` 可清除缓存重新加载
- 创建项目时可用 `create-zhin` 生成上述模板

### Heartbeat 与 Scheduler

若启用统一调度器，**HEARTBEAT.md** 会按周期（默认 30 分钟）被检查。若文件存在且内容非空，Agent 会执行一次固定 prompt。你可通过 `edit_file` / `write_file` 管理其中的任务列表。详见 [定时任务](/advanced/cron)。

### 文件制记忆

`data/memory/MEMORY.md` 用于长期记忆，`data/memory/{date}.md` 用于今日笔记。AI 可通过 `write_file` 写入重要事项。系统自动在 system prompt 中注入 Memory 段落。

## 输出解析

`parseOutput` 将 AI 的文本回复解析为结构化的 `OutputElement[]`：

### OutputElement 类型

| 类型 | 说明 |
|------|------|
| `TextElement` | 纯文本 |
| `ImageElement` | 图片（URL 或 base64） |
| `AudioElement` | 音频 |
| `VideoElement` | 视频 |
| `CardElement` | 卡片消息（带字段和按钮） |
| `FileElement` | 文件附件 |

### 渲染方法

- `renderToPlainText(elements)` — 渲染为纯文本
- `renderToSatori(elements)` — 渲染为 Satori XML

## 权限控制

工具可以设置权限级别，AI Agent 会根据发送者权限自动过滤：

| 级别 | 说明 | 数值 |
|------|------|------|
| `user` | 普通用户（所有人） | 0 |
| `group_admin` | 群管理员 | 1 |
| `group_owner` | 群主 | 2 |
| `bot_admin` | 机器人管理员 | 3 |
| `owner` | 机器人拥有者 | 4 |

## 执行安全 (execSecurity)

控制 AI 调用 `bash` 工具的权限。

### 策略模式

| 模式 | 说明 |
|------|------|
| `deny` | 禁止所有 Shell 命令（默认） |
| `allowlist` | 仅允许白名单内的命令 |
| `full` | 不限制（危险，仅开发环境使用） |

### 预设白名单 (execPreset)

| 预设 | 包含命令 |
|------|---------|
| `readonly` | ls, cat, pwd, date, whoami, grep, find, head, tail, wc |
| `network` | readonly + curl, wget, ping, dig |
| `development` | network + npm, npx, node, git, python, pip, pnpm, yarn |
| `custom` | 仅使用自定义 `execAllowlist` |

preset 和 `execAllowlist` 会合并，即 `execPreset: network` + `execAllowlist: ["docker"]` 会允许网络命令和 docker。

### 子任务安全

SubagentManager 的 `bash` 工具也受同一 execSecurity 策略约束，不存在安全绕过。

## Provider 统一抽象

所有 Provider 共享统一接口：

```typescript
interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  contextWindow?: number   // 上下文窗口大小（token 数）
  capabilities?: {
    vision?: boolean
    streaming?: boolean
    toolCalling?: boolean
    thinking?: boolean
  }
}
```

各 Provider 将 `contextWindow` 映射到自身参数（Ollama → `num_ctx`，OpenAI/Anthropic 用于窗口管理）。

### 查询能力

```typescript
const caps = aiService.getProviderCapabilities('ollama')
// { contextWindow: 32768, capabilities: { vision: true, streaming: true, ... } }
```

## 小模型适配

针对 8B 及以下小模型的优化策略。

### 模型大小推断

系统根据模型名称自动推断大小：
- **small**：`qwen3:8b`, `llama3.2:3b` 等（参数量 ≤ 8B）
- **medium**：`qwen3:14b`, `llama3.1:32b` 等（14B-32B）
- **large**：`gpt-4o`, `claude-sonnet` 等（> 32B 或 API 模型）

可通过 `modelSizeHint` 手动覆盖推断结果。

### 技能指令分级截断

根据模型大小动态调整 `extractSkillInstructions` 的截断长度：
- **small**：1500 字符（只保留 intro + 快速操作段）
- **medium**：4000 字符（默认）
- **large**：8000 字符（更完整的技能指令）

可通过 `skillInstructionMaxChars` 手动覆盖。

### SKILL.md 摘要协议

SKILL.md 作者可添加 `## 快速操作` / `## Quick Actions` 段落。小模型优先只使用该摘要段，避免信息过载导致幻觉。

## 流式输出

当适配器支持时，AI 以流式方式输出响应。通过 `OnChunkCallback` 实现：

```typescript
type OnChunkCallback = (chunk: string, full: string) => void

agent.process(content, context, tools, (chunk, full) => {
  // chunk: 增量文本片段
  // full: 到目前为止的完整文本
  updateMessage(full)
})
```

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

需配置 `visionModel` 或使用默认模型。

## 自定义 Provider

只要兼容 OpenAI Chat Completions API 格式，就可以接入：

```yaml
ai:
  providers:
    my-local:
      baseURL: "http://my-server:8000/v1"
      apiKey: "optional-key"
      contextWindow: 32000
```

或实现 `AIProvider` 接口注册自定义 Provider：

```typescript
import { AIService } from '@zhin.js/core'

class MyProvider implements AIProvider {
  name = 'my-provider'
  models = ['my-model']
  contextWindow = 32000
  capabilities = { streaming: true, toolCalling: true }
  
  async chat(request) { /* ... */ }
  async *chatStream(request) { /* ... */ }
}

aiService.registerProvider(new MyProvider())
```
