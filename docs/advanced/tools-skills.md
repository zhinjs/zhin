# 工具与技能

## 技能可以不要，工具能不能也不要？

**不能混为一谈：**

| 层次 | 作用 | 不用它时 |
|------|------|----------|
| **Tool（工具）** | AI 通过 function calling **真正执行**的能力（调接口、改数据、发消息等） | 若仍要让 AI **办事**，就必须保留对应 Tool；否则 AI 只能 **纯聊天**，无法替你操作插件。 |
| **Skill（SKILL.md / SkillFeature）** | **可选**：长说明、`activate_skill`、粗筛里帮模型缩小工具范围 | 可以 **不写 SKILL**；工具仍可通过 `keywords/tags` 和全量收集参与筛选。Core **不提供** `declareSkill`。 |

**非 AI 路径**：不需要「技能」时，能力可以完全放在 **命令 `addCommand`、HTTP API、CLI、定时任务** 上——**不注册 Tool** 即可，与 SKILL 无关。

**通用性建议**：SKILL 里只写 **跨平台通用的流程与约束**；平台差异放进 **Tool 的 description / parameters**。重复、无激活价值、只为凑关键词的 SKILL 可以 **直接删掉**，避免「垃圾技能」；保留精简工具与清晰 `keywords` 往往更稳。

---

工具（Tool）是 AI 可调用的具体操作；技能（Skill）是可选的语义层，用于说明与粗筛（当前推荐磁盘 `SKILL.md`）。

> **插件包推荐**：AI 工具用 **`agent/tools/*.ts` + `defineAgentTool`**；技能用 **`agent/skills/*.md`**（Markdown，不把 `defineSkill` TS 当主路径）。由 `discoverPluginAgentSurface` 在启动时注册；路径即身份（如 `agent/tools/sync.ts` → `lottery_sync`）。完整约定见 [Plugin agent/ 创作面](./agent-authoring.md)。
>
> **遗留（软弃用）**：`plugin.addTool` / `src` 里手写注册、工作区 `*.tool.md`、程序化 `defineSkill` —— 运行时仍可用，新代码请迁到上述推荐路径。

## 概念关系

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '13px' }}}%%
graph LR
  S(["🎯 Skill — 可选\nSKILL.md / 粗筛"])

  S --- D["📝 描述\n群聊管理能力"]
  S --- K["🔑 关键词\n群管理 · 踢人 · 禁言"]
  S --- T["🏷️ 标签\ngroup · management · im"]
  S --- TL["🔧 工具列表"]

  TL --> T1("icqq_kick_member")
  TL --> T2("icqq_mute_member")
  TL --> T3("icqq_set_admin")
  TL --> T4("...")

  classDef skill fill:#e65100,stroke:#bf360c,color:#fff,rx:16
  classDef meta fill:#fff3e0,stroke:#e65100,color:#bf360c,rx:8
  classDef toolList fill:#1565c0,stroke:#0d47a1,color:#fff,rx:8
  classDef tool fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,rx:12

  class S skill
  class D,K,T meta
  class TL toolList
  class T1,T2,T3,T4 tool
```

AI Agent 处理消息时常见流程：
1. **粗筛**：用户消息匹配 Skill（含关键词）或直接从工具池按相关性选 Tool
2. **细筛**：权限过滤 + 相关性排序（无 Skill 时仍可对 **全部已注册 Tool** 做细筛）

## 工具（Tool）

### 注册工具

使用 `addTool`（ToolFeature）注册工具（**非 Agent 创作面推荐路径**；AI 工具请用 `agent/tools` + `defineAgentTool`）：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

addTool({
  name: 'search_music',
  description: '按关键词搜索音乐，返回歌曲名、歌手和链接',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
      limit: { type: 'number', description: '返回数量，默认 5' },
    },
    required: ['keyword'],
  },
  tags: ['音乐', '搜索'],
  keywords: ['音乐', '歌', '听歌', '搜歌'],
  execute: async (args) => {
    const results = await musicAPI.search(args.keyword, args.limit || 5)
    return results
  },
})
```

### Tool 接口

`Tool` 支持泛型参数推断（默认 `Record<string, any>`，向后兼容）：

```typescript
interface Tool<TArgs extends Record<string, any> = Record<string, any>> {
  // 必填
  name: string                           // 工具名称（全局唯一）
  description: string                    // 描述（AI 用来理解工具用途）
  parameters: ToolParametersSchema<TArgs>  // 参数定义（JSON Schema 格式）
  execute: (args: TArgs, context?: ToolContext) => MaybePromise<ToolResult>  // 执行函数
  
  // 可选 - AI 发现
  tags?: string[]                 // 分类标签
  keywords?: string[]             // 触发关键词
  
  // 可选 - 约束
  platforms?: string[]            // 限定平台（如 ['icqq']）
  scopes?: ('private'|'group'|'channel')[]  // 限定场景
  requiredAnyRole?: SenderRole[]            // 需具备的角色之一（省略=仅需 user）
  hidden?: boolean                // 对 AI 隐藏
  preExecutable?: boolean         // 允许预执行（无副作用的只读工具）
  
  // 可选 - 元数据
  source?: string                 // 来源标识
  kind?: string                   // 工具分类（如 file / shell / web）
}
```

### ToolResult 返回类型

工具的 `execute` 返回 `ToolResult`，支持多种形式：

```typescript
type ToolResult =
  | string               // 直接作为文本回复
  | { text: string }     // 结构化文本
  | { data: any; format?: string }  // 结构化数据
  | void | null | undefined  // 无回复
  | any                  // 其他类型自动 JSON.stringify
```

### 使用 ZhinTool 链式 DSL

`ZhinTool` 提供更简洁的链式写法：

```typescript
import { usePlugin, ZhinTool } from 'zhin.js'

const { addTool } = usePlugin()

addTool(
  new ZhinTool('get_weather')
    .desc('查询城市天气')
    .param('city', 'string', '城市名称', true)
    .param('unit', 'string', '温度单位(C/F)', false)
    .platform('icqq')           // 仅 ICQQ 平台可用
    .scope('group')             // 仅群聊可用
    // 省略 requireAnyRole 即所有 user 可用
    .execute(async (args) => {
      return await fetchWeather(args.city, args.unit)
    })
)
```

### 使用 defineAgentTool（Agent 创作面，推荐）

插件 AI 工具请放在 `agent/tools/*.ts`，从 `@zhin.js/agent/tools` 导入 **`defineAgentTool`**（勿与 `@zhin.js/core` / `zhin.js` 的命令侧 `defineTool` 混淆）：

```typescript
import { defineAgentTool } from '@zhin.js/agent/tools'
import { z } from 'zod'

export default defineAgentTool<{ city: string; unit?: string }>({
  description: '查询城市天气',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
    unit: z.string().optional().describe('温度单位'),
  }),
  execute: async ({ city, unit }) => {
    return await fetchWeather(city, unit)
  },
})
```

命令/非 Agent 工具若仍用 core 的 `defineTool` + `addTool`，见上文「使用 addTool」；新 AI 能力不要再走该路径。

### 文件化 Tool（*.tool.md）（遗留 / 软弃用）

::: warning 软弃用
工作区 `*.tool.md` 与 `cwd/tools/` 扫描仍可用，但**新插件 AI 工具请用 `agent/tools/*.ts` + `defineAgentTool`**。计划下一 major 收紧对 `*.tool.md` 的推荐。
:::

除了 `agent/tools`，框架历史上还支持通过 `*.tool.md` 声明工具。框架自动扫描、注册、热重载。

#### 发现顺序

1. 工作区 `cwd/tools/`
2. `~/.zhin/tools/`
3. `data/tools/`（框架默认数据目录）
4. **已加载插件**：根插件与直接子插件包根目录下的 `tools/`

同名 Tool 先发现者优先。**程序化注册的同名 Tool 优先于文件化版本。**

#### 文件结构

支持两种组织方式：

```text
tools/
├── greeting.tool.md              # 扁平：纯模板，无需 handler 文件
└── calculator/
    ├── calculator.tool.md        # 嵌套：带 handler
    └── handler.ts                # 执行逻辑
```

#### 带 handler 的 Tool

```markdown
---
name: calculator
description: 计算数学表达式，支持加减乘除和括号
parameters:
  expression:
    type: string
    description: 数学表达式
    required: true
keywords: [计算, 算]
tags: [utility, math]
handler: ./handler.ts
---
```

Handler 文件导出默认函数：

```typescript
// tools/calculator/handler.ts
export default async function(args: { expression: string }) {
  const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, '')
  const result = new Function(`return ${sanitized}`)()
  return `${args.expression} = ${result}`
}
```

#### 纯模板 Tool（无 handler）

当没有 `handler` 字段时，body 作为模板，`{{param}}` 自动替换为参数值：

```markdown
---
name: greeting
description: 生成个性化问候语
parameters:
  name:
    type: string
    description: 用户名
    required: true
  time:
    type: string
    description: 时间段
    enum: [morning, afternoon, evening]
tags: [utility]
---

你好，{{name}}！{{time}}好，欢迎来到 Zhin 机器人世界。
```

#### Frontmatter 字段一览

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 工具名称（全局唯一） |
| `description` | string | ✅ | 工具描述 |
| `parameters` | object | — | 简写参数定义（见下） |
| `handler` | string | — | handler 文件路径（相对于 .tool.md） |

| `keywords` | string[] | — | 触发关键词 |
| `tags` | string[] | — | 分类标签 |
| `platforms` | string[] | — | 限定平台 |
| `scopes` | string[] | — | 限定场景 |
| `requiredAnyRole` | string / string[] | — | 需具备的角色之一（如 `trusted`、`scene_admin`） |
| `kind` | string | — | 工具分类 |
| `hidden` | boolean | — | 是否隐藏 |

参数简写格式（自动转换为 `ToolParametersSchema`）：

```yaml
parameters:
  city:
    type: string
    description: 城市名称
    required: true
  unit:
    type: string
    description: 温度单位
    enum: [C, F]
    default: C
```

#### 热重载

工作区 `cwd/tools/` 目录支持热重载——新增、修改、删除 `*.tool.md` 文件后，框架会在 400ms 内自动重新发现并注册。

## 内置工具

须已安装 **`@zhin.js/agent`**（见 [AI 模块 — 安装与依赖](/advanced/ai#安装与依赖-zhinjs-4x)）。框架内置了一组 AI 可直接使用的工具（由 `@zhin.js/agent` 提供），无需手动注册：

| 工具 | 说明 |
|------|------|
| `bash` | 执行 Shell 命令（受 `execSecurity` / `execApprovalMode` 约束；`allowlist` 下 `icqq …` 非敏感子命令可直接放行，敏感子命令见 [执行安全 — icqq](/advanced/ai#icqq-bash-exec)） |
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件 |
| `edit_file` | 编辑文件（基于 diff） |
| `list_dir` | 列出目录 |
| `glob` | 按模式匹配文件 |
| `grep` | 搜索文件内容 |
| `web_search` | 网页搜索 |
| `web_fetch` | 抓取网页内容 |
| `ask_user` | 向用户提问并等待回答 |
| `chat_history` | 按需查 `im_transcripts`（`keyword` + `limit`；关键词触发注入） |
| `user_profile` | 读写用户偏好（关键词触发） |
| `schedule_followup` | 安排定时跟进提醒（关键词触发） |
| `spawn_task` | 创建后台子任务（主 Agent 常驻；`turn-pipeline` 每轮注入） |
| `discover` | 发现 deferred 工具/技能 |
| `load_tool` / `load_skill` | 按需加载 schema / 技能说明 |
| `install_skill` | 从 URL 安装技能 |

### ask_user — 用户确认工具

`ask_user` 工具允许 AI 主动向用户提问并等待回答。典型场景：

- **危险操作确认**：当 `execApprovalMode: ask` 且命令不在白名单时，AI 用 `ask_user` 向用户确认
- **bash / icqq Owner 流程**：敏感 `icqq …` 子命令或需 Owner 硬编排的 bash 结果会触发确认；Bot Owner 可在私聊使用 **`approve always bash`**、**`approve rule <正则>`** 等减少重复确认，详见 [执行安全 — approve](/advanced/ai#owner-approve-commands)
- **信息补全**：AI 需要更多信息才能完成任务时主动询问
- **选择确认**：提供选项让用户选择

```json
{
  "name": "ask_user",
  "arguments": {
    "question": "要执行 npm install 吗？",
    "choices": ["是", "否"]
  }
}
```

`ask_user` 通过 IM 消息发送问题，等待用户回复后将答案返回给 AI 继续处理。超时未回复则返回超时提示。

## Agent 预设（*.agent.md）

Agent 预设用于声明领域专长 Agent，AI 可自动识别场景并委派子任务。

### 发现顺序

1. 工作区 `cwd/agents/`
2. `~/.zhin/agents/`
3. `data/agents/`
4. 已加载插件包根目录下的 `agents/`

### 文件格式

```markdown
---
name: code-reviewer
description: 代码审查专家，擅长发现 bug 和优化建议
keywords: [代码, 审查, review, bug]
tags: [development]
tools: [read_file, grep, edit_file]
model: gpt-4o
maxIterations: 8
---

你是一个资深代码审查员，专注于安全和性能问题。

## 审查规则
1. 检查输入验证和 SQL 注入风险
2. 检查资源泄漏（未关闭的连接、定时器）
3. 检查异步错误处理
```

### Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | Agent 名称 |
| `description` | string | ✅ | Agent 描述 |
| `keywords` | string[] | — | 触发关键词 |
| `tags` | string[] | — | 分类标签 |
| `tools` | string[] | — | 关联工具名列表 |
| `model` | string | — | 首选模型 |
| `provider` | string | — | 首选 Provider |
| `maxIterations` | number | — | 最大迭代次数 |

Body（frontmatter 之后的正文）作为 Agent 的 `systemPrompt` 注入。

## 插件清单（plugin.yml）

插件可在包根目录放置 `plugin.yml` 声明元数据：

```yaml
name: my-plugin
description: 我的示例插件
version: 1.0.0
```

通过 `plugin.manifest` getter 访问：

```typescript
const plugin = usePlugin()
console.log(plugin.manifest)
// → { name: 'my-plugin', description: '...', version: '1.0.0' }
```

如果 `plugin.yml` 不存在，会自动 fallback 到 `package.json` 的 `name`/`description`/`version`。

## 技能（Skill）

### 技能目录与发现顺序

文件化技能（`SKILL.md`）的发现与 `activate_skill` 查找路径一致，优先级为：

1. 工作区 `cwd/skills/<name>/SKILL.md`
2. `~/.zhin/skills/<name>/SKILL.md`
3. `.agents/skills/<name>/SKILL.md`（从 cwd 向上至 git 根，[ADR 0010](../adr/0010-pi-coding-agent-harness-alignment.md)）
4. **已加载插件**：根插件与**直接子插件**包目录下的 `skills/<name>/SKILL.md`（**遗留**；新插件请用 `agent/skills/*.md`）
5. `zhin packages install` 安装目录：`~/.zhin/packages/` 或项目 `.zhin/packages/`（`zhin packages list` 查看）

插件包 **`agent/skills/*.md`** 由独立的 `discoverPluginAgentSurface` 扫描（与上表并行，非替代关系）。两条路径可同时存在；**同名 `name` 时后注册覆盖先注册**。详见 [agent-authoring.md](./agent-authoring.md#与遗留-skills-并存框架能力)。

> **已移除** `data/skills/` 发现路径；请迁移到 `skills/`、`.agents/skills/` 或 `zhin packages`。

`install_skill` 默认仍安装到工作区 `skills/`。工作区 `skills/` 支持热重载（见下文及 AI 文档）。

### 在插件中声明

#### 推荐：`agent/` 创作面

插件包内用 `agent/tools/*.ts`（`defineAgentTool`）与 `agent/skills/*.md`（按需说明）声明 AI 能力；启动时由 `discoverPluginAgentSurface` 注册，无需在 `src/index.ts` 手写 `addTool`：

```text
plugins/utils/my-plugin/
├── agent/
│   ├── tools/sync.ts          # → my_plugin_sync
│   └── skills/my-plugin.md    # 关联工具、keywords、platforms
└── src/index.ts
```

详见 [agent-authoring.md](./agent-authoring.md)（adapter 混合模式、optional peer、npm publish）。

#### 遗留：包内 `skills/<name>/SKILL.md`

尚未迁移的插件仍可在包根放 `skills/<技能名>/SKILL.md`（frontmatter 含 `name`、`description`、`keywords`、`tags`；可选 `tools` 列表）。Agent 通过 `discoverWorkspaceSkills` 与同路径的 `activate_skill` 发现。**新插件请用 `agent/skills/*.md`，勿再新增 `skills/` 目录。**

```text
plugins/utils/my-plugin/skills/my-plugin/SKILL.md   # legacy
```

### 在适配器中声明

#### 推荐：`agent/tools/` + `agent/skills/`

平台特有工具放在 `agent/tools/<slot>.ts`（`defineAgentTool`，运行时名 `{adapter}_{slot}`）；平台说明放在 `agent/skills/<adapter>.md`。群管标准工具仍在 `src/index.ts` 由 `createSceneManagementTools()` 注册（见 [agent-authoring.md](./agent-authoring.md#adapter-hybrid-platform-tools--scene-tools)）。

#### 遗留：包内 `skills/<name>/SKILL.md`

旧路径 `skills/＜适配器名＞/SKILL.md` 仍会被 `discoverWorkspaceSkills` 扫描；**`Adapter.declareSkill` 已从 Core 移除**。

**平台绑定（`platforms`）**：frontmatter 中声明 `platforms: [icqq]`、`[github]` 等与适配器名一致的列表时，只要用户消息来自该平台（`ToolContext.platform` 命中），Agent 会自动把 **`activate_skill`** 与该技能关联工具纳入本轮工具集，**不必**依赖用户在句子里显式提到技能名；与 `keywords` 文本触发互为补充。仅因平台合并进来的技能，其关联工具也会保留在候选集中（避免与用户句无语义重叠时被相关性过滤误删）。需要全文常驻说明时用 `always: true`。

#### 群管理能力（推荐：覆写方法自动检测）

群管理是 IM 的通用能力。Adapter 基类声明了 `ISceneManagement` 接口中的可选方法规范，适配器只需覆写自己平台支持的方法，`start()` 会自动检测并**生成群管 Tool**（Skill 粗筛依赖 `SKILL.md` 或工具 `keywords`，不再由适配器代码注册 Skill）：

```typescript
class IcqqAdapter extends Adapter<IcqqEndpoint> {
  // 覆写标准群管方法 —— 内部委托给 Endpoint 的原生 API
  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const bot = this.endpoints.get(endpointId)
    if (!bot) throw new Error(`Endpoint ${endpointId} 不存在`)
    return bot.kickMember(Number(sceneId), Number(userId), false)
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.endpoints.get(endpointId)
    if (!bot) throw new Error(`Endpoint ${endpointId} 不存在`)
    return bot.muteMember(Number(sceneId), Number(userId), duration)
  }

  async listMembers(endpointId: string, sceneId: string) {
    const bot = this.endpoints.get(endpointId)
    if (!bot) throw new Error(`Endpoint ${endpointId} 不存在`)
    const memberMap = await bot.getMemberList(Number(sceneId))
    return { members: Array.from(memberMap.values()), count: memberMap.size }
  }

  async start() {
    this.registerIcqqPlatformTools()  // 注册平台特有工具（头衔、公告、戳一戳等）
    await super.start()               // 自动检测上述 3 个方法 → 生成 Tool → 注册 Skill
  }
}
```

目前 10 余个 IM 适配器（含 ICQQ、OneBot11、Milky、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书等）已采用此模式，Satori、OneBot 12 等协议适配器见 [平台适配器索引](/adapters/)：

| 适配器 | 覆写的标准方法 | 保留的平台特有工具 |
|--------|---------------|-------------------|
| ICQQ | kick, mute, muteAll, setAdmin, setNickname, setGroupName, listMembers | 头衔、群公告、戳一戳、禁言列表等 |
| OneBot11 | kick, mute, muteAll, setAdmin, setNickname, setGroupName, listMembers, getGroupInfo | 头衔 |
| Milky | kick, mute, muteAll, setAdmin, setNickname, setGroupName, listMembers, getGroupInfo | — |
| Telegram | kick, unban, mute, setAdmin, setGroupName, getGroupInfo | 置顶、投票、反应、贴纸、权限等 |
| Discord | kick, ban, unban, mute, setNickname, listMembers, getGroupInfo | 角色管理、帖子/论坛、反应、Embed |
| KOOK | kick, ban, unban, setNickname, listMembers | 角色管理、黑名单 |
| QQ 官方 | kick, mute, muteAll, listMembers, getGroupInfo | 频道/子频道、角色管理 |
| Slack | kick, setGroupName, listMembers, getGroupInfo | 邀请、话题、归档、反应等 |
| 钉钉 | kick, setGroupName, getGroupInfo | 部门管理、工作通知等 |
| 飞书 | kick, listMembers, getGroupInfo, setGroupName | 管理员设置、解散群等 |

可用的群管理方法规范：

| 方法 | 说明 | 权限级别 |
|------|------|---------|
| `kickMember` | 踢出成员 | scene_admin |
| `muteMember` | 禁言（duration=0 解除） | scene_admin |
| `setMemberNickname` | 设置群昵称/名片 | scene_admin |
| `setAdmin` | 设置/取消管理员 | scene_owner |
| `listMembers` | 获取成员列表 | user |
| `banMember` | 封禁成员 | scene_admin |
| `unbanMember` | 解除封禁 | scene_admin |
| `setGroupName` | 修改群名称 | scene_admin |
| `muteAll` | 全员禁言/解除 | scene_admin |
| `getGroupInfo` | 获取群信息 | user |

#### 群管理使用指南

AI 在调用群管理工具时会遵循以下规则（已内置到 Skill 描述中）：

1. **用户名到 ID 的解析** — 当用户只提供昵称/名片时，AI 会先调用 `list_members` 查询成员列表，匹配目标用户的 `user_id`，再执行后续操作
2. **禁言场景** — `mute_member` 适用于违规发言、刷屏、骚扰等需要临时限制发言的场景。`duration` 单位为秒，传 0 表示解除禁言，默认 600 秒（10 分钟）
3. **管理员操作** — `set_admin` 需要群主权限，普通管理员无法操作；`enable=false` 为取消管理员
4. **踢人与封禁的区别** — `kick_member` 是将成员移出群聊（可再次加入），`ban_member` 是永久拉黑
5. **操作前确认** — AI 会确认目标用户正确后再执行，避免误操作

#### 平台特有工具约束

不同平台的特有工具有各自的使用限制：

| 平台 | 工具 | 约束 |
|------|------|------|
| ICQQ | `icqq_poke` | 每次请求只戳一次，不重复调用 |
| ICQQ | `icqq_send_user_like` | 每人每天最多 20 次 |
| ICQQ | `icqq_list_muted` | 仅查询，不执行禁言操作 |
| ICQQ | `icqq_set_title` | 需要群主权限 |

#### 平台特有工具

对于标准群管以外的平台特有操作（如 ICQQ 的头衔/群公告、Discord 的角色管理/Embed 等），放在 `agent/tools/<slot>.ts`（`defineAgentTool` + deps 注入）；平台级 AI 说明放在 `agent/skills/<adapter>.md`。遗留适配器可能仍在 `start()` 里 `addTool()`，新代码请迁到 `agent/tools/`。

```typescript
// agent/tools/set_title.ts — slot → icqq_set_title
import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool({
  description: '设置群成员头衔',
  parameters: z.object({ userId: z.string(), title: z.string() }),
  execute: async ({ userId, title }) => { /* 通过 icqq-agent-deps 取 endpoint */ },
});
```

### Skill 接口

```typescript
interface Skill {
  name: string              // 技能名称
  description: string       // 描述（含 conventions）
  tools: Tool[]             // 包含的工具
  platforms?: string[]      // 若声明且含当前会话 platform，自动注入 activate_skill（无需用户写出技能名）
  keywords?: string[]       // 触发关键词
  tags?: string[]           // 分类标签
  pluginName: string        // 来源插件
}
```

## 权限控制（SenderRole 集合）

### 角色

```typescript
type SenderRole = 'user' | 'scene_admin' | 'scene_owner' | 'trusted' | 'master'
```

| 角色 | 含义 |
|------|------|
| `user` | 默认（无其它角色时仅此） |
| `scene_admin` / `scene_owner` | IM 群管 / 群主 |
| `trusted` | 本 bot 可信操作员（配置 `trusted` / `bots[].trusted`） |
| `master` | 本 bot 主人 + 全局 trigger `masters` |

工具声明 `requiredAnyRole?: SenderRole[]`：调用者 `context.roles` 须**包含其一**（匹配时 `scene_owner` 隐含 `scene_admin`，`master` 隐含 `trusted`；`master` 不隐含群管角色）。

### 两层校验

**第一层：AI 前过滤** — `canAccessTool` 在工具收集阶段按 `roles` + `requiredAnyRole` 过滤。

**第二层：运行时** — `execute` 收到的 `ToolContext.roles` 与文件/命令安全策略一致。

### Breaking Changes

- 删除阶梯 `permissionLevel` / `ToolPermissionLevel`；改用 `requiredAnyRole` 与 `ZhinTool.requireAnyRole()`。
- 配置：`owners`→`masters`，`botAdmins`→`trusted`，`bots[].owner`→`bots[].master`，`bots[].admins`→`bots[].trusted`。
- 群聊 session 用户消息前缀：`roles=`（不再使用 `perm=`）。

## Tool 与 Command 互转

### 工具自动生成命令

## 去重机制

当同一个工具同时通过 Skill 路径和 externalTools 路径被收集时，`collectTools` 会自动去重：
- Skill 路径优先
- 同名工具只保留第一次收集到的

## 完整示例

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addTool, addCommand, logger } = usePlugin()

// 工具 1：搜索音乐
addTool(
  new ZhinTool('search_music')
    .desc('搜索音乐')
    .param('keyword', 'string', '搜索关键词', true)
    .param('limit', 'number', '返回数量', false)
    .execute(async (args) => {
      const results = await musicAPI.search(args.keyword, args.limit || 5)
      return { songs: results, count: results.length }
    })
)

// 工具 2：获取歌词
addTool({
  name: 'get_lyrics',
  description: '获取指定歌曲的歌词',
  parameters: {
    type: 'object',
    properties: {
      songId: { type: 'string', description: '歌曲 ID' },
    },
    required: ['songId'],
  },
  keywords: ['歌词', '词'],
  execute: async (args) => {
    return await musicAPI.getLyrics(args.songId)
  },
})

// 另：在插件包 skills/my-music/SKILL.md 写 name/description/keywords，供 Agent 发现（无 declareSkill API）

// 同时也注册一个命令（传统调用方式）
addCommand(
  new MessageCommand('music <keyword:word>')
    .desc('搜索音乐')
    .action(async (_, result) => {
      const data = await musicAPI.search(result.params.keyword, 3)
      return data.map(s => `${s.name} - ${s.artist}`).join('\n')
    })
)
```
