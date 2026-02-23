# 工具与技能

工具（Tool）和技能（Skill）是 Zhin.js AI 模块的核心概念。工具是 AI 可以调用的具体操作，技能是一组相关工具的语义化分组。

## 概念关系

```
Skill（技能）
├── 描述："QQ 群管理能力"
├── 关键词：["QQ", "群管理"]
├── 调用约定："用户和群使用数字 QQ号标识"
└── 工具列表：
    ├── Tool: icqq_kick_member
    ├── Tool: icqq_mute_member
    ├── Tool: icqq_set_admin
    └── ...
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

```typescript
interface Tool {
  // 必填
  name: string                    // 工具名称（全局唯一）
  description: string             // 描述（AI 用来理解工具用途）
  parameters: JSONSchema          // 参数定义（JSON Schema 格式）
  execute: (args, context?) => any  // 执行函数
  
  // 可选 - AI 发现
  tags?: string[]                 // 分类标签
  keywords?: string[]             // 触发关键词
  
  // 可选 - 约束
  platforms?: string[]            // 限定平台（如 ['icqq']）
  scopes?: ('private'|'group'|'channel')[]  // 限定场景
  permissionLevel?: ToolPermissionLevel     // 权限要求
  hidden?: boolean                // 对 AI 隐藏
  
  // 可选 - 命令互转
  command?: { pattern: string } | false  // 同时生成命令
  
  // 可选 - 元数据
  source?: string                 // 来源标识
}
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

适配器使用 `declareSkill()` 方法将平台工具聚合为 Skill，并附加平台调用约定：

```typescript
class MyAdapter extends Adapter<MyBot> {
  async start() {
    // 注册平台工具
    this.addTool({ name: 'my_kick', ... })
    this.addTool({ name: 'my_mute', ... })
    
    // 声明 Skill（conventions 描述平台特性）
    this.declareSkill({
      description: '群管理能力，包括踢人、禁言等',
      keywords: ['群管理', '踢人', '禁言'],
      tags: ['群管理'],
      conventions: '用户和群使用数字 ID。bot 参数填 Bot ID，group_id 填场景 ID。',
    })
    
    await super.start()
  }
}
```

`conventions` 字段会拼接到 Skill 描述末尾，AI 选中该 Skill 时能看到平台的调用约定，减少参数填错的情况。

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
