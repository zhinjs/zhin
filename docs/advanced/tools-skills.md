# 工具与技能

工具（Tool）和技能（Skill）是 Zhin.js AI 模块的核心概念。工具是 AI 可以调用的具体操作，技能是一组相关工具的语义化分组。

## 概念关系

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '13px' }}}%%
graph LR
  S(["🎯 Skill — 技能\n由 start() 自动检测并注册"])

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

AI Agent 处理消息时的两级过滤：
1. **粗筛**：根据用户消息匹配相关的 Skill
2. **细筛**：从 Skill 中筛选具体的 Tool（权限过滤 + 相关性排序）

## 工具（Tool）

### 注册工具

使用 `addTool`（ToolFeature 扩展方法）注册工具：

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
  permissionLevel?: ToolPermissionLevel     // 权限要求
  hidden?: boolean                // 对 AI 隐藏
  preExecutable?: boolean         // 允许预执行（无副作用的只读工具）
  
  // 可选 - 命令互转
  command?: { pattern: string } | false  // 同时生成命令
  
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
    .permission('user')         // 所有用户可用
    .execute(async (args) => {
      return await fetchWeather(args.city, args.unit)
    })
)
```

### 使用 defineTool（类型安全）

`defineTool<TArgs>` 利用 `Tool<TArgs>` 的泛型支持，让 `execute` 的 `args` 参数获得完整的类型提示：

```typescript
import { defineTool } from 'zhin.js'

const weatherTool = defineTool<{ city: string; unit?: string }>({
  name: 'get_weather',
  description: '查询城市天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
      unit: { type: 'string', description: '温度单位' },
    },
    required: ['city'],
  },
  execute: async (args) => {
    // args 类型为 { city: string; unit?: string }
    return await fetchWeather(args.city, args.unit)
  },
})
```

> **注意：** 旧的 `ToolDefinition<TArgs>` 已废弃，现在是 `Tool<TArgs>` 的类型别名。直接使用 `Tool<TArgs>` 即可。

## 技能（Skill）

### 在插件中声明

当插件提供了多个相关工具时，通过 `declareSkill` 将它们分组：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool, declareSkill } = usePlugin()

// 注册多个相关工具
addTool({ name: 'search_music', ... })
addTool({ name: 'play_music', ... })
addTool({ name: 'music_lyrics', ... })

// 声明技能（自动聚合上面注册的工具）
declareSkill({
  description: '音乐服务，支持搜索、播放和歌词查询',
  keywords: ['音乐', '歌', '播放', '歌词', '听'],
  tags: ['music', '娱乐'],
})
```

`declareSkill` 会自动：
- 收集当前插件注册的所有工具
- 聚合工具的 keywords 和 tags
- 注册到全局 SkillFeature

### 在适配器中声明

#### 群管理能力（推荐：覆写方法自动检测）

群管理是 IM 的通用能力。Adapter 基类声明了 `IGroupManagement` 接口中的可选方法规范，适配器只需覆写自己平台支持的方法，`start()` 会自动检测并生成 Tool + 注册 Skill，无需任何手动调用：

```typescript
class IcqqAdapter extends Adapter<IcqqBot> {
  // 覆写标准群管方法 —— 内部委托给 Bot 的原生 API
  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId)
    if (!bot) throw new Error(`Bot ${botId} 不存在`)
    return bot.kickMember(Number(sceneId), Number(userId), false)
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId)
    if (!bot) throw new Error(`Bot ${botId} 不存在`)
    return bot.muteMember(Number(sceneId), Number(userId), duration)
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId)
    if (!bot) throw new Error(`Bot ${botId} 不存在`)
    const memberMap = await bot.getMemberList(Number(sceneId))
    return { members: Array.from(memberMap.values()), count: memberMap.size }
  }

  async start() {
    this.registerIcqqPlatformTools()  // 注册平台特有工具（头衔、公告、戳一戳等）
    await super.start()               // 自动检测上述 3 个方法 → 生成 Tool → 注册 Skill
  }
}
```

目前 10 余个 IM 适配器（含 ICQQ、OneBot11、Milky、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书等）已采用此模式，Satori、OneBot 12 等协议适配器见 [适配器](/essentials/adapters) 一览：

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
| `kickMember` | 踢出成员 | group_admin |
| `muteMember` | 禁言（duration=0 解除） | group_admin |
| `setMemberNickname` | 设置群昵称/名片 | group_admin |
| `setAdmin` | 设置/取消管理员 | group_owner |
| `listMembers` | 获取成员列表 | user |
| `banMember` | 封禁成员 | group_admin |
| `unbanMember` | 解除封禁 | group_admin |
| `setGroupName` | 修改群名称 | group_admin |
| `muteAll` | 全员禁言/解除 | group_admin |
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

对于标准群管以外的平台特有操作（如 ICQQ 的头衔/群公告、Discord 的角色管理/Embed 等），在 `start()` 中通过 `addTool()` 手动注册。这些工具会被 `super.start()` 的自动检测机制一并收录到 Skill 中，无需单独调用 `declareSkill()`：

```typescript
class IcqqAdapter extends Adapter<IcqqBot> {
  // 标准群管方法（自动检测）
  async kickMember(...) { /* ... */ }
  async muteMember(...) { /* ... */ }

  async start() {
    // 注册平台特有工具
    this.addTool({ name: 'icqq_set_title', ... })
    this.addTool({ name: 'icqq_announce', ... })
    this.addTool({ name: 'icqq_poke', ... })

    await super.start()
    // 自动检测 kickMember / muteMember → 生成标准 Tool
    // 连同 set_title / announce / poke 一起聚合为 "群聊管理" Skill
  }
}
```

如果适配器完全没有覆写任何 `IGroupManagement` 方法但仍需注册 Skill，可以手动调用 `declareSkill()`。

### Skill 接口

```typescript
interface Skill {
  name: string              // 技能名称
  description: string       // 描述（含 conventions）
  tools: Tool[]             // 包含的工具
  keywords?: string[]       // 触发关键词
  tags?: string[]           // 分类标签
  pluginName: string        // 来源插件
}
```

## 权限控制

### 权限级别

```typescript
type ToolPermissionLevel = 
  | 'user'          // 普通用户（默认，所有人可用）
  | 'group_admin'   // 群管理员
  | 'group_owner'   // 群主
  | 'bot_admin'     // 机器人管理员
  | 'owner'         // 机器人拥有者
```

### 两层校验

**第一层：AI 前过滤**
在工具收集阶段，权限不足的工具不会出现在 AI 的可选列表中：
```
发送者是普通用户 → AI 只能看到 permissionLevel: 'user' 的工具
发送者是群管理员 → AI 能看到 'user' + 'group_admin' 的工具
```

**第二层：运行时校验**
工具执行时，ToolContext 会注入到 execute 函数中，适配器在执行前再次校验权限：

```typescript
execute: async (args, context) => {
  this.checkPermission(context, 'group_admin')  // 运行时二次校验
  // ... 执行实际操作
}
```

## Tool 与 Command 互转

### 工具自动生成命令

注册工具时通过 `command` 选项同时生成命令：

```typescript
addTool({
  name: 'get_weather',
  description: '查询天气',
  parameters: { ... },
  command: { pattern: 'weather <city:string>' },  // 自动生成命令
  execute: async (args) => { ... },
})
```

用户可以通过 `weather 北京` 命令调用，AI 也可以通过工具调用。

### 手动转换

```typescript
import { toolToCommand, commandToTool } from 'zhin.js'

// Tool -> Command
const command = toolToCommand(myTool)

// Command -> Tool（第二个参数为插件名）
const tool = commandToTool(myCommand, 'my-plugin')
```

## 去重机制

当同一个工具同时通过 Skill 路径和 externalTools 路径被收集时，`collectTools` 会自动去重：
- Skill 路径优先
- 同名工具只保留第一次收集到的

## 完整示例

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addTool, addCommand, declareSkill, logger } = usePlugin()

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

// 声明技能
declareSkill({
  description: '音乐服务，支持搜索音乐和获取歌词',
  keywords: ['音乐', '歌', '歌词', '听', '搜歌'],
  tags: ['music', '娱乐'],
})

// 同时也注册一个命令（传统调用方式）
addCommand(
  new MessageCommand('music <keyword:string>')
    .desc('搜索音乐')
    .action(async (_, result) => {
      const data = await musicAPI.search(result.params.keyword, 3)
      return data.map(s => `${s.name} - ${s.artist}`).join('\n')
    })
)
```
