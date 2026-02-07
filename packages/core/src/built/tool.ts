/**
 * Tool Service
 * 统一的工具管理服务，支持 Tool ↔ Command 互转
 */
import { MessageCommand } from "../command.js";
import { Message } from "../message.js";
import { Context, Plugin, getPlugin } from "../plugin.js";
import type { Tool, ToolDefinition, RegisteredAdapter, AdapterMessage, ToolContext, ToolJsonSchema, ToolParametersSchema, PropertySchema, MaybePromise, ToolPermissionLevel, ToolScope } from "../types.js";
import { MatchResult } from "segment-matcher";

// ============================================================================
// 权限级别比较
// ============================================================================

/**
 * 权限级别优先级（数字越大权限越高）
 */
const PERMISSION_LEVEL_PRIORITY: Record<ToolPermissionLevel, number> = {
  'user': 0,
  'group_admin': 1,
  'group_owner': 2,
  'bot_admin': 3,
  'owner': 4,
};

/**
 * 比较两个权限级别
 * @returns 如果 a >= b 返回 true
 */
function hasPermissionLevel(userLevel: ToolPermissionLevel, requiredLevel: ToolPermissionLevel): boolean {
  return PERMISSION_LEVEL_PRIORITY[userLevel] >= PERMISSION_LEVEL_PRIORITY[requiredLevel];
}

/**
 * 从 ToolContext 推断用户的权限级别
 */
function inferPermissionLevel(context: ToolContext): ToolPermissionLevel {
  if (context.senderPermissionLevel) {
    return context.senderPermissionLevel;
  }
  
  // 按优先级检查
  if (context.isOwner) return 'owner';
  if (context.isBotAdmin) return 'bot_admin';
  if (context.isGroupOwner) return 'group_owner';
  if (context.isGroupAdmin) return 'group_admin';
  
  return 'user';
}

/**
 * 检查工具是否可被当前上下文访问
 */
function canAccessTool(tool: Tool, context: ToolContext): boolean {
  // 1. 检查平台限制
  if (tool.platforms && tool.platforms.length > 0) {
    if (!context.platform || !tool.platforms.includes(context.platform)) {
      return false;
    }
  }
  
  // 2. 检查场景限制
  if (tool.scopes && tool.scopes.length > 0) {
    if (!context.scope || !tool.scopes.includes(context.scope)) {
      return false;
    }
  }
  
  // 3. 检查权限级别
  const requiredLevel = tool.permissionLevel || 'user';
  const userLevel = inferPermissionLevel(context);
  
  if (!hasPermissionLevel(userLevel, requiredLevel)) {
    return false;
  }
  
  return true;
}

// ============================================================================
// Tool 工具函数
// ============================================================================

/**
 * 从 Tool 参数生成命令模式
 * @example
 * parameters: { properties: { city: { type: 'string' } }, required: ['city'] }
 * => 'toolName <city>'
 */
export function generatePattern(tool: Tool): string {
  const { name, parameters } = tool;
  
  if (tool.command && tool.command.pattern) {
    return tool.command.pattern;
  }
  
  if (!parameters.properties) {
    return name;
  }
  
  const parts: string[] = [name];
  const props = parameters.properties;
  const required = parameters.required || [];
  
  // 按照 required 优先、字母顺序排序
  const sortedKeys = Object.keys(props).sort((a, b) => {
    const aReq = required.includes(a) ? 0 : 1;
    const bReq = required.includes(b) ? 0 : 1;
    if (aReq !== bReq) return aReq - bReq;
    return a.localeCompare(b);
  });
  
  for (const key of sortedKeys) {
    const prop = props[key];
    const isRequired = required.includes(key);
    const paramType = prop.paramType || (prop.type === 'number' ? 'number' : 'text');
    
    if (isRequired) {
      parts.push(`<${key}:${paramType}>`);
    } else {
      parts.push(`[${key}:${paramType}]`);
    }
  }
  
  return parts.join(' ');
}

/**
 * 从参数定义中提取参数信息
 */
export function extractParamInfo(parameters: ToolJsonSchema): Tool.ParamInfo[] {
  if (!parameters.properties) return [];
  
  const required = parameters.required || [];
  return Object.entries(parameters.properties).map(([name, schema]) => ({
    name,
    type: schema.type,
    required: required.includes(name),
    description: schema.description,
    default: schema.default,
    enum: schema.enum,
  }));
}

/**
 * 定义工具的辅助函数（提供类型推断）
 * 
 * 使用泛型参数获得 execute 函数的类型检查，
 * 返回通用的 Tool 类型，可直接传给 addTool
 * 
 * @example
 * ```typescript
 * const myTool = defineTool<{ name: string }>({
 *   name: 'greet',
 *   description: '打招呼',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       name: { type: 'string', description: '名字' }
 *     },
 *     required: ['name']
 *   },
 *   execute: async (args) => {
 *     return `你好，${args.name}！`;  // args.name 有类型提示
 *   }
 * });
 * 
 * plugin.addTool(myTool);  // 无需类型断言
 * ```
 */
export function defineTool<TArgs extends Record<string, any> = Record<string, any>>(
  tool: ToolDefinition<TArgs>
): Tool {
  // ToolDefinition<TArgs> 兼容 Tool，因为 execute 参数是协变的
  return tool as Tool;
}

// ============================================================================
// ZhinTool 类（链式调用风格）
// ============================================================================

/**
 * 参数定义（带顺序）
 */
interface ParamDef {
  name: string;
  schema: PropertySchema;
  required: boolean;
}

/**
 * ZhinTool 类
 * 提供类似 MessageCommand 的链式调用风格来定义工具
 * 
 * @example
 * ```typescript
 * const weatherTool = new ZhinTool('weather')
 *   .desc('查询天气信息')
 *   .param('city', { type: 'string', description: '城市名称' }, true)
 *   .param('days', { type: 'number', description: '预报天数' })
 *   .platform('qq', 'telegram')
 *   .scope('group', 'private')
 *   .permission('user')
 *   // AI 调用时执行（必须）
 *   .execute(async (args, ctx) => {
 *     return `${args.city} 的天气是晴天`;
 *   })
 *   // 可选：命令回调（与 MessageCommand.action 一致）
 *   // 如果定义了此回调，会生成 Command
 *   .action(async (message, result) => {
 *     return `命令执行: ${result.params.city}`;
 *   });
 * 
 * plugin.addTool(weatherTool);
 * ```
 */
export class ZhinTool {
  #name: string;
  #description: string = '';
  /** 有序的参数列表 */
  #params: ParamDef[] = [];
  #execute?: (args: Record<string, any>, context?: ToolContext) => MaybePromise<any>;
  #platforms: string[] = [];
  #scopes: ToolScope[] = [];
  #permissionLevel: ToolPermissionLevel = 'user';
  #permissions: string[] = [];
  #tags: string[] = [];
  #keywords: string[] = [];
  /** 命令回调（入参是 message, matchResult） */
  #commandCallback?: MessageCommand.Callback<RegisteredAdapter>;
  /** 命令配置 */
  #commandConfig: Omit<Tool.CommandConfig, 'enabled'> = {};
  #hidden: boolean = false;
  #source?: string;

  /**
   * 创建工具实例
   * @param name 工具名称（唯一标识，建议使用 snake_case）
   */
  constructor(name: string) {
    this.#name = name;
  }

  /** 获取工具名称 */
  get name(): string {
    return this.#name;
  }

  /** 获取工具描述 */
  get description(): string {
    return this.#description;
  }

  /** 获取有序的参数列表 */
  get params(): ParamDef[] {
    return [...this.#params];
  }

  /**
   * 设置工具描述
   * @param description 工具描述（供 AI 和帮助系统使用）
   */
  desc(description: string): this {
    this.#description = description;
    return this;
  }

  /**
   * 添加参数（按调用顺序保持有序）
   * @param name 参数名称
   * @param schema 参数 Schema（类型、描述等）
   * @param required 是否必填（默认 false）
   */
  param(name: string, schema: PropertySchema, required: boolean = false): this {
    // 如果已存在同名参数，更新它
    const existingIndex = this.#params.findIndex(p => p.name === name);
    if (existingIndex >= 0) {
      this.#params[existingIndex] = { name, schema, required };
    } else {
      this.#params.push({ name, schema, required });
    }
    return this;
  }

  /**
   * 设置支持的平台
   * @param platforms 平台名称列表（如 'qq', 'telegram'）
   */
  platform(...platforms: string[]): this {
    this.#platforms.push(...platforms);
    return this;
  }

  /**
   * 设置支持的场景
   * @param scopes 场景类型列表（'private', 'group', 'channel'）
   */
  scope(...scopes: ToolScope[]): this {
    this.#scopes.push(...scopes);
    return this;
  }

  /**
   * 设置权限级别
   * @param level 权限级别（'user', 'group_admin', 'group_owner', 'bot_admin', 'owner'）
   */
  permission(level: ToolPermissionLevel): this {
    this.#permissionLevel = level;
    return this;
  }

  /**
   * 添加旧版权限要求（兼容 MessageCommand）
   * @param permissions 权限字符串列表
   */
  permit(...permissions: string[]): this {
    this.#permissions.push(...permissions);
    return this;
  }

  /**
   * 添加标签
   * @param tags 标签列表
   */
  tag(...tags: string[]): this {
    this.#tags.push(...tags);
    return this;
  }

  /**
   * 添加触发关键词（用于程序化工具过滤，Agent.filterTools 使用）
   * 用户消息包含这些关键词时，此工具会被优先选中
   * @param keywords 关键词列表（支持中英文）
   */
  keyword(...keywords: string[]): this {
    this.#keywords.push(...keywords);
    return this;
  }

  /**
   * 设置是否隐藏
   * @param value 是否隐藏（默认 true）
   */
  hidden(value: boolean = true): this {
    this.#hidden = value;
    return this;
  }

  /**
   * 设置使用说明（命令配置）
   * @param usage 使用说明列表
   */
  usage(...usage: string[]): this {
    this.#commandConfig.usage = [...(this.#commandConfig.usage || []), ...usage];
    return this;
  }

  /**
   * 设置示例（命令配置）
   * @param examples 示例列表
   */
  examples(...examples: string[]): this {
    this.#commandConfig.examples = [...(this.#commandConfig.examples || []), ...examples];
    return this;
  }

  /**
   * 设置别名（命令配置）
   * @param alias 别名列表
   */
  alias(...alias: string[]): this {
    this.#commandConfig.alias = [...(this.#commandConfig.alias || []), ...alias];
    return this;
  }

  /**
   * 设置自定义命令模式
   * @param pattern 命令模式（如 'weather <city> [days]'）
   */
  pattern(pattern: string): this {
    this.#commandConfig.pattern = pattern;
    return this;
  }

  /**
   * 设置 AI 工具执行函数
   * @param callback 执行回调，入参是 (args, context)
   */
  execute(callback: (args: Record<string, any>, context?: ToolContext) => MaybePromise<any>): this {
    this.#execute = callback;
    return this;
  }

  /**
   * 设置命令回调（可选，与 MessageCommand.action 一致）
   * 如果定义了此回调，会自动生成 Command
   * 入参是 (message, matchResult)
   * 
   * @param callback 命令回调
   */
  action(callback: MessageCommand.Callback<RegisteredAdapter>): this {
    this.#commandCallback = callback;
    return this;
  }

  /**
   * 构建有序的 ToolParametersSchema
   */
  #buildParameters(): ToolParametersSchema {
    const properties: Record<string, PropertySchema> = {};
    const required: string[] = [];
    
    // 按顺序构建（必填参数排前面）
    const sortedParams = [...this.#params].sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      return 0;
    });
    
    for (const param of sortedParams) {
      properties[param.name] = param.schema;
      if (param.required) {
        required.push(param.name);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * 生成命令模式字符串
   */
  #generatePattern(): string {
    if (this.#commandConfig.pattern) {
      return this.#commandConfig.pattern;
    }
    
    const parts: string[] = [this.#name];
    
    // 按顺序生成参数（必填在前，可选在后）
    const sortedParams = [...this.#params].sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      return 0;
    });
    
    for (const param of sortedParams) {
      const paramType = param.schema.paramType || (param.schema.type === 'number' ? 'number' : 'text');
      if (param.required) {
        parts.push(`<${param.name}:${paramType}>`);
      } else {
        parts.push(`[${param.name}:${paramType}]`);
      }
    }
    
    return parts.join(' ');
  }

  /**
   * 转换为 Tool 对象
   */
  toTool(): Tool {
    if (!this.#execute) {
      throw new Error(`Tool "${this.#name}" has no execute() defined`);
    }

    const tool: Tool = {
      name: this.#name,
      description: this.#description,
      parameters: this.#buildParameters(),
      execute: this.#execute,
    };

    // 添加可选字段
    if (this.#platforms.length > 0) tool.platforms = this.#platforms;
    if (this.#scopes.length > 0) tool.scopes = this.#scopes;
    if (this.#permissionLevel !== 'user') tool.permissionLevel = this.#permissionLevel;
    if (this.#permissions.length > 0) tool.permissions = this.#permissions;
    if (this.#tags.length > 0) tool.tags = this.#tags;
    if (this.#hidden) tool.hidden = this.#hidden;
    if (this.#source) tool.source = this.#source;
    if (this.#keywords.length > 0) (tool as any).keywords = this.#keywords;

    // 命令配置：如果没有定义 command 回调，则不生成命令
    if (!this.#commandCallback) {
      tool.command = false;
    } else {
      tool.command = {
        ...this.#commandConfig,
        pattern: this.#generatePattern(),
        enabled: true,
      };
    }

    return tool;
  }

  /**
   * 获取 action 回调（命令回调，如果有）
   */
  getActionCallback(): MessageCommand.Callback<RegisteredAdapter> | undefined {
    return this.#commandCallback;
  }

  /**
   * 转换为 JSON 格式（供 AI 使用，不包含 execute 函数）
   * 符合 OpenAI Function Calling 规范
   */
  toJSON(): {
    name: string;
    description: string;
    parameters: ToolParametersSchema;
    platforms?: string[];
    scopes?: ToolScope[];
    permissionLevel?: ToolPermissionLevel;
    tags?: string[];
  } {
    const json: ReturnType<ZhinTool['toJSON']> = {
      name: this.#name,
      description: this.#description,
      parameters: this.#buildParameters(),
    };

    // 添加可选字段
    if (this.#platforms.length > 0) json.platforms = this.#platforms;
    if (this.#scopes.length > 0) json.scopes = this.#scopes;
    if (this.#permissionLevel !== 'user') json.permissionLevel = this.#permissionLevel;
    if (this.#tags.length > 0) json.tags = this.#tags;

    return json;
  }

  /**
   * 输出帮助信息（类似 MessageCommand）
   */
  get help(): string {
    const lines: string[] = [this.#generatePattern()];
    if (this.#description) lines.push(`  ${this.#description}`);
    
    // 参数信息（按顺序）
    if (this.#params.length > 0) {
      lines.push('  参数:');
      for (const param of this.#params) {
        const required = param.required ? '(必填)' : '(可选)';
        const desc = param.schema.description || '';
        lines.push(`    ${param.name}: ${param.schema.type} ${required} ${desc}`);
      }
    }
    
    // 权限信息
    if (this.#permissionLevel !== 'user') {
      lines.push(`  权限: ${this.#permissionLevel}`);
    }
    
    // 平台限制
    if (this.#platforms.length > 0) {
      lines.push(`  平台: ${this.#platforms.join(', ')}`);
    }
    
    // 场景限制
    if (this.#scopes.length > 0) {
      lines.push(`  场景: ${this.#scopes.join(', ')}`);
    }
    
    // 命令说明
    if (this.#commandConfig.usage?.length) {
      lines.push('  用法:');
      for (const u of this.#commandConfig.usage) {
        lines.push(`    ${u}`);
      }
    }
    
    // 命令示例
    if (this.#commandConfig.examples?.length) {
      lines.push('  示例:');
      for (const e of this.#commandConfig.examples) {
        lines.push(`    ${e}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 输出简短信息
   */
  toString(): string {
    return `[ZhinTool: ${this.#name}] ${this.#description}`;
  }
}

// 为了兼容 addTool，让 ZhinTool 可以隐式转换为 Tool
// 通过在 ToolService 中检查是否是 ZhinTool 实例
export function isZhinTool(obj: any): obj is ZhinTool {
  return obj instanceof ZhinTool;
}

// ============================================================================
// ToolService 类型定义
// ============================================================================

/**
 * 工具输入类型（支持 Tool 对象或 ZhinTool 实例）
 */
export type ToolInput = Tool | ZhinTool;

/**
 * ToolService 扩展方法类型
 */
export interface ToolContextExtensions {
  /** 添加工具（自动生成命令） */
  addTool(tool: ToolInput): () => void;
  /** 仅添加工具，不生成命令 */
  addToolOnly(tool: ToolInput): () => void;
}

// 扩展 Plugin 接口
declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends ToolContextExtensions {}
    interface Contexts {
      tool: ToolService;
    }
  }
}

/**
 * 工具服务
 */
export interface ToolService {
  /** 所有注册的工具 */
  readonly tools: Map<string, Tool>;
  
  /** 工具对应的命令（如果生成了） */
  readonly toolCommands: Map<string, MessageCommand<RegisteredAdapter>>;
  
  /** 添加工具（支持 Tool 对象或 ZhinTool 实例） */
  add(tool: ToolInput, pluginName: string, generateCommand?: boolean): () => void;
  
  /** 移除工具 */
  remove(name: string): boolean;
  
  /** 获取工具 */
  get(name: string): Tool | undefined;
  
  /** 获取所有工具 */
  getAll(): Tool[];
  
  /** 根据标签过滤工具 */
  getByTags(tags: string[]): Tool[];
  
  /** 执行工具 */
  execute(name: string, args: Record<string, any>, context?: ToolContext): Promise<any>;
  
  /** 将 Command 转换为 Tool */
  commandToTool(command: MessageCommand<RegisteredAdapter>, pluginName: string): Tool;
  
  /** 收集所有可用工具（包括从 Command 转换的） */
  collectAll(plugin: Plugin): Tool[];
  
  /** 
   * 根据上下文过滤工具
   * 检查平台、场景、权限是否匹配
   */
  filterByContext(tools: Tool[], context: ToolContext): Tool[];
}

/**
 * 将 Tool 转换为 MessageCommand
 */
function toolToCommand(tool: Tool): MessageCommand<RegisteredAdapter> {
  const pattern = generatePattern(tool);
  const command = new MessageCommand<RegisteredAdapter>(pattern);
  
  // 设置描述
  command.desc(tool.description);
  
  // 设置使用说明
  if (tool.command && tool.command.usage) {
    command.usage(...tool.command.usage);
  }
  
  // 设置示例
  if (tool.command && tool.command.examples) {
    command.examples(...tool.command.examples);
  }
  
  // 设置权限
  if (tool.permissions?.length) {
    command.permit(...tool.permissions);
  }
  
  // 设置执行回调
  command.action(async (message: Message<AdapterMessage<RegisteredAdapter>>, result: MatchResult) => {
    // 构建工具上下文
    const context: ToolContext = {
      platform: message.$adapter,
      botId: message.$bot,
      sceneId: message.$channel?.id || message.$sender.id,
      senderId: message.$sender.id,
      message,
    };
    
    // 从 MatchResult 提取参数
    const args = extractArgsFromMatchResult(result, tool.parameters);
    
    try {
      const response = await tool.execute(args, context);
      
      // 处理返回值
      if (response === undefined || response === null) {
        return undefined;
      }
      
      if (typeof response === 'string') {
        return response;
      }
      
      // 对象类型，格式化输出
      return formatToolResult(response);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return `❌ 执行失败: ${errorMsg}`;
    }
  });
  
  return command;
}

/**
 * 将 MessageCommand 转换为 Tool
 */
function commandToTool(
  command: MessageCommand<RegisteredAdapter>,
  pluginName: string
): Tool {
  const { pattern, helpInfo } = command;
  
  // 解析命令模式，提取参数
  const parameters = parseCommandPattern(pattern);
  
  return {
    name: `cmd_${pattern.split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '_')}`,
    description: helpInfo.desc.join(' ') || `执行命令: ${pattern}`,
    parameters,
    source: `command:${pluginName}`,
    tags: ['command', pluginName],
    execute: async (args, context) => {
      // 重建命令字符串
      const cmdParts = [pattern.split(' ')[0]];
      
      if (parameters.properties) {
        for (const [key, schema] of Object.entries(parameters.properties)) {
          if (args[key] !== undefined) {
            cmdParts.push(String(args[key]));
          }
        }
      }
      
      const cmdString = cmdParts.join(' ');
      
      // 如果有消息上下文，模拟命令执行
      if (context?.message) {
        // 创建一个临时消息副本，修改内容为命令字符串
        const tempMessage = Object.create(context.message);
        tempMessage.$content = cmdString;
        
        const plugin = getPlugin();
        const result = await command.handle(tempMessage, plugin);
        return result;
      }
      
      return { 
        error: '此工具需要消息上下文才能执行',
        command: cmdString 
      };
    },
    command: false, // 不再生成命令（已经是命令了）
  };
}

/**
 * 从 MatchResult 提取参数
 */
function extractArgsFromMatchResult(
  result: MatchResult,
  schema: ToolJsonSchema
): Record<string, any> {
  const args: Record<string, any> = {};
  
  // params 包含所有提取的参数
  if (result.params) {
    Object.assign(args, result.params);
  }
  
  // 类型转换
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (args[key] !== undefined) {
        if (prop.type === 'number') {
          args[key] = Number(args[key]);
        } else if (prop.type === 'boolean') {
          args[key] = args[key] === 'true' || args[key] === true;
        } else if (prop.type === 'array' && typeof args[key] === 'string') {
          args[key] = args[key].split(',').map((s: string) => s.trim());
        }
      }
    }
  }
  
  return args;
}

/**
 * 解析命令模式，生成参数 Schema
 * @example 'weather <city> [days:number]' => { properties: { city: {...}, days: {...} }, required: ['city'] }
 */
function parseCommandPattern(pattern: string): ToolParametersSchema {
  const properties: Record<string, PropertySchema> = {};
  const required: string[] = [];
  
  // 匹配 <name:type> 或 [name:type] 格式
  const paramRegex = /([<\[])(\w+)(?::(\w+))?([>\]])/g;
  let match;
  
  while ((match = paramRegex.exec(pattern)) !== null) {
    const [, bracket, name, type] = match;
    const isRequired = bracket === '<';
    
    const schemaType = type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string';
    properties[name] = {
      type: schemaType,
      description: `参数: ${name}`,
    } as PropertySchema;
    
    if (isRequired) {
      required.push(name);
    }
  }
  
  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  } as ToolParametersSchema;
}

/**
 * 格式化工具执行结果
 */
function formatToolResult(result: any): string {
  if (result === null || result === undefined) {
    return '';
  }
  
  if (typeof result === 'string') {
    return result;
  }
  
  if (result.error) {
    return `❌ ${result.error}`;
  }
  
  // 尝试友好格式化
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * 创建工具服务 Context
 */
export function createToolService(): Context<'tool', ToolContextExtensions> {
  const tools = new Map<string, Tool>();
  const toolCommands = new Map<string, MessageCommand<RegisteredAdapter>>();
  const toolPluginMap = new Map<string, string>();
  
  const value: ToolService = {
    tools,
    toolCommands,
    
    add(toolInput, pluginName, generateCommand = true) {
      // 保存原始 ZhinTool 引用（用于获取命令回调）
      const zhinTool = isZhinTool(toolInput) ? toolInput : null;
      
      // 转换为 Tool 对象
      const tool: Tool = zhinTool ? zhinTool.toTool() : toolInput as Tool;
      
      // 自动添加来源标识
      const toolWithSource: Tool = {
        ...tool,
        source: tool.source || `plugin:${pluginName}`,
        tags: [...(tool.tags || []), 'plugin', pluginName],
      };
      
      tools.set(tool.name, toolWithSource);
      toolPluginMap.set(tool.name, pluginName);
      
      // 生成对应的命令
      // 只有当 tool.command !== false 且 generateCommand 为 true 时才生成
      if (generateCommand && tool.command !== false) {
        let command: MessageCommand<RegisteredAdapter>;
        
        // 如果是 ZhinTool 且有自定义 action 回调，使用自定义回调
        const customCallback = zhinTool?.getActionCallback();
        if (customCallback) {
          // 使用自定义回调创建命令
          command = new MessageCommand<RegisteredAdapter>(
            tool.command && typeof tool.command === 'object' && tool.command.pattern 
              ? tool.command.pattern 
              : generatePattern(toolWithSource)
          );
          
          command.desc(tool.description);
          
          if (tool.command && typeof tool.command === 'object') {
            if (tool.command.usage) command.usage(...tool.command.usage);
            if (tool.command.examples) command.examples(...tool.command.examples);
          }
          
          if (tool.permissions?.length) {
            command.permit(...tool.permissions);
          }
          
          // 使用自定义回调
          command.action(customCallback);
        } else {
          // 使用默认的 toolToCommand（基于 tool.execute）
          command = toolToCommand(toolWithSource);
        }
        
        toolCommands.set(tool.name, command);
        
        // 注册到命令服务
        const plugin = getPlugin();
        const commandService = plugin.root.inject('command');
        if (commandService) {
          commandService.add(command, pluginName);
        }
      }
      
      return () => value.remove(tool.name);
    },
    
    remove(name) {
      const existed = tools.has(name);
      tools.delete(name);
      toolPluginMap.delete(name);
      
      // 移除对应的命令
      const command = toolCommands.get(name);
      if (command) {
        const plugin = getPlugin();
        const commandService = plugin.root.inject('command');
        if (commandService) {
          commandService.remove(command);
        }
        toolCommands.delete(name);
      }
      
      return existed;
    },
    
    get(name) {
      return tools.get(name);
    },
    
    getAll() {
      return Array.from(tools.values());
    },
    
    getByTags(tags) {
      return Array.from(tools.values()).filter(tool => 
        tags.some(tag => tool.tags?.includes(tag))
      );
    },
    
    async execute(name, args, context) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool "${name}" not found`);
      }
      return tool.execute(args, context);
    },
    
    commandToTool,
    
    collectAll(plugin) {
      const allTools: Tool[] = [];
      
      // 1. 收集 ToolService 中的所有工具
      allTools.push(...value.getAll());
      
      // 2. 收集 Command 并转换为 Tool
      const commandService = plugin.root.inject('command');
      if (commandService) {
        for (const command of commandService.items) {
          // 跳过已经由 Tool 生成的命令
          const isFromTool = Array.from(toolCommands.values()).includes(command);
          if (!isFromTool) {
            const toolFromCmd = commandToTool(command, 'command');
            allTools.push(toolFromCmd);
          }
        }
      }
      
      // 3. 收集适配器提供的工具
      for (const [name, context] of plugin.root.contexts) {
        const adapterValue = context.value;
        if (adapterValue && typeof adapterValue === 'object' && 'getTools' in adapterValue) {
          const adapter = adapterValue as { getTools(): Tool[] };
          allTools.push(...adapter.getTools());
        }
      }
      
      return allTools;
    },
    
    filterByContext(tools, context) {
      return tools.filter(tool => canAccessTool(tool, context));
    },
  };
  
  return {
    name: 'tool',
    description: '统一工具服务',
    value,
    extensions: {
      addTool(tool: ToolInput) {
        const plugin = getPlugin();
        const dispose = value.add(tool, plugin.name, true);
        plugin.onDispose(dispose);
        return dispose;
      },
      addToolOnly(tool: ToolInput) {
        const plugin = getPlugin();
        const dispose = value.add(tool, plugin.name, false);
        plugin.onDispose(dispose);
        return dispose;
      },
    },
  };
}

// 导出类型和工具函数
// 注意：ZhinTool, isZhinTool, ToolInput 已通过 export 关键字直接导出
export { 
  toolToCommand, 
  commandToTool,
  canAccessTool,
  inferPermissionLevel,
  hasPermissionLevel,
  PERMISSION_LEVEL_PRIORITY,
};

