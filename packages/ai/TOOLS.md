# AI 工具系统

@zhin.js/ai 插件支持从多个来源收集和使用 AI 工具，实现更强大的 Agent 能力。

## 工具来源

### 1. 内置工具 (Builtin Tools)

AI 服务内置了一些常用工具：

- `get_time`: 获取当前时间
- `calculate`: 进行数学计算
- `search_web`: 网页搜索（需配置）

### 2. 适配器工具 (Adapter Tools)

每个适配器可以提供平台特定的工具：

```typescript
// 适配器继承 Adapter 基类后自动获得 addTool 方法
class MyAdapter extends Adapter<MyBot> {
  constructor(plugin: Plugin) {
    super(plugin, 'my-platform', config);
    
    // 注册默认工具（发送消息、列出 Bot 等）
    this.registerDefaultTools();
    
    // 注册自定义工具
    this.addTool({
      name: 'my_platform_get_user',
      description: '获取平台用户信息',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: '用户 ID' }
        },
        required: ['userId']
      },
      execute: async (args) => {
        return await this.getUserInfo(args.userId);
      }
    });
  }
}
```

**Process 适配器示例工具**：
- `process_send_message`: 发送消息
- `process_list_bots`: 列出已连接的 Bot
- `process_get_info`: 获取进程信息
- `process_get_env`: 获取环境变量
- `process_console_log`: 输出到控制台

### 3. 插件工具 (Plugin Tools)

任何插件都可以注册自己的工具：

```typescript
import { usePlugin, defineTool } from 'zhin.js';

const { addTool } = usePlugin();

// 使用 defineTool 获得类型支持
const weatherTool = defineTool({
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
      unit: { 
        type: 'string', 
        enum: ['celsius', 'fahrenheit'],
        description: '温度单位'
      }
    },
    required: ['city']
  },
  execute: async (args) => {
    const { city, unit = 'celsius' } = args;
    // 调用天气 API
    return { city, temperature: 25, unit };
  }
});

// 注册工具
addTool(weatherTool);

// 或直接传入对象
addTool({
  name: 'translate',
  description: '翻译文本',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要翻译的文本' },
      from: { type: 'string', description: '源语言' },
      to: { type: 'string', description: '目标语言' }
    },
    required: ['text', 'to']
  },
  execute: async (args) => {
    // 翻译逻辑
    return { translated: '...' };
  }
});
```

### 4. 自定义工具 (Custom Tools)

直接在 AI 服务中注册工具：

```typescript
import { usePlugin } from 'zhin.js';

const { useContext } = usePlugin();

useContext('ai', (ai) => {
  // 注册自定义工具
  const dispose = ai.registerTool({
    name: 'custom_tool',
    description: '自定义工具',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ result: 'custom' })
  });
  
  return dispose; // 清理时自动移除
});
```

## 使用工具

### 通过 Agent

```typescript
useContext('ai', (ai) => {
  // 创建 Agent 时自动收集所有可用工具
  const agent = ai.createAgent({
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: '你是一个智能助手',
    // 可选：禁用自动收集外部工具
    // collectExternalTools: false,
    // 可选：禁用内置工具
    // useBuiltinTools: false,
    // 可选：添加额外工具
    tools: [myExtraTool]
  });
  
  // 执行任务
  const result = await agent.run('查询北京的天气并用英语描述');
  console.log(result.content);
  console.log(result.toolCalls); // 查看工具调用记录
});
```

### 通过命令

```
# 查看所有可用工具
/ai.tools

# 使用带工具调用的对话
/chat 帮我查一下现在的时间
```

## 工具收集机制

AI 服务通过以下方式收集工具：

1. **Plugin.collectAllTools()**: 遍历插件树收集所有插件注册的工具
2. **Adapter.getTools()**: 收集所有适配器注册的工具
3. **AIService.customTools**: 直接在 AI 服务中注册的工具
4. **AIService.builtinTools**: 内置工具

```
AIService.createAgent()
    ├── builtinTools (内置工具)
    ├── customTools (自定义工具)
    ├── Plugin.collectAllTools() 
    │   ├── 当前插件的工具
    │   └── 所有子插件的工具（递归）
    └── Adapter.getTools()
        ├── 默认工具（send_message, list_bots）
        └── 平台特定工具
```

## 最佳实践

### 工具命名规范

- 使用小写字母和下划线
- 包含来源前缀避免冲突：`platform_action` 或 `plugin_action`
- 例如：`icqq_get_group_members`, `music_search_song`

### 参数设计

```typescript
{
  type: 'object',
  properties: {
    // 必填参数放前面
    userId: { 
      type: 'string', 
      description: '用户唯一标识符' 
    },
    // 可选参数给默认值
    limit: { 
      type: 'number', 
      description: '返回数量限制',
      default: 10
    },
    // 枚举类型明确列出选项
    format: {
      type: 'string',
      enum: ['json', 'text', 'markdown'],
      description: '返回格式'
    }
  },
  required: ['userId'] // 明确必填项
}
```

### 错误处理

```typescript
execute: async (args, context) => {
  try {
    const result = await doSomething(args);
    return { success: true, data: result };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

### 安全考虑

```typescript
execute: async (args, context) => {
  // 检查上下文权限
  if (context?.senderId !== 'admin') {
    return { error: '权限不足' };
  }
  
  // 过滤敏感操作
  if (args.path?.includes('..')) {
    return { error: '非法路径' };
  }
  
  // 执行操作
  return await secureOperation(args);
}
```

## 类型定义

```typescript
interface AITool {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述（AI 用于理解用途） */
  description: string;
  /** 参数 JSON Schema */
  parameters: ToolJsonSchema;
  /** 工具执行函数 */
  execute: (args: Record<string, any>, context?: ToolContext) => Promise<any>;
  /** 工具来源标识（自动添加） */
  source?: string;
  /** 工具标签（用于分类过滤） */
  tags?: string[];
}

interface ToolContext {
  platform?: string;   // 来源平台
  botId?: string;      // Bot ID
  sceneId?: string;    // 场景 ID
  senderId?: string;   // 发送者 ID
  extra?: Record<string, any>; // 额外数据
}

interface ToolJsonSchema {
  type: string;
  properties?: Record<string, ToolJsonSchema>;
  required?: string[];
  items?: ToolJsonSchema;
  enum?: any[];
  description?: string;
  default?: any;
}
```
