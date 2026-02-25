/**
 * ToolFeature — 统一的工具管理服务
 * 支持 Tool ↔ Command 互转
 */
import { Feature, FeatureJSON } from "../feature.js";
import { MessageCommand } from "../command.js";
import { Message } from "../message.js";
import { Plugin, getPlugin } from "../plugin.js";
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
 */
export function defineTool<TArgs extends Record<string, any> = Record<string, any>>(
  tool: ToolDefinition<TArgs>
): Tool {
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
  #preExecutable: boolean = false;
  #kind?: string;

  constructor(name: string) {
    this.#name = name;
  }

  get name(): string {
    return this.#name;
  }

  get description(): string {
    return this.#description;
  }

  get params(): ParamDef[] {
    return [...this.#params];
  }

  desc(description: string): this {
    this.#description = description;
    return this;
  }

  param(name: string, schema: PropertySchema, required: boolean = false): this {
    const existingIndex = this.#params.findIndex(p => p.name === name);
    if (existingIndex >= 0) {
      this.#params[existingIndex] = { name, schema, required };
    } else {
      this.#params.push({ name, schema, required });
    }
    return this;
  }

  platform(...platforms: string[]): this {
    this.#platforms.push(...platforms);
    return this;
  }

  scope(...scopes: ToolScope[]): this {
    this.#scopes.push(...scopes);
    return this;
  }

  permission(level: ToolPermissionLevel): this {
    this.#permissionLevel = level;
    return this;
  }

  permit(...permissions: string[]): this {
    this.#permissions.push(...permissions);
    return this;
  }

  tag(...tags: string[]): this {
    this.#tags.push(...tags);
    return this;
  }

  keyword(...keywords: string[]): this {
    this.#keywords.push(...keywords);
    return this;
  }

  hidden(value: boolean = true): this {
    this.#hidden = value;
    return this;
  }

  /**
   * 标记此工具允许被预执行（opt-in）。
   * 仅适用于无副作用的只读工具（如获取系统状态、读取配置等）。
   * 默认为 false，即不预执行。
   */
  preExec(value: boolean = true): this {
    this.#preExecutable = value;
    return this;
  }

  /** 设置工具分类（如 file / shell / web），用于展示与 TOOLS.md 协同 */
  kind(value: string): this {
    this.#kind = value;
    return this;
  }

  usage(...usage: string[]): this {
    this.#commandConfig.usage = [...(this.#commandConfig.usage || []), ...usage];
    return this;
  }

  examples(...examples: string[]): this {
    this.#commandConfig.examples = [...(this.#commandConfig.examples || []), ...examples];
    return this;
  }

  alias(...alias: string[]): this {
    this.#commandConfig.alias = [...(this.#commandConfig.alias || []), ...alias];
    return this;
  }

  pattern(pattern: string): this {
    this.#commandConfig.pattern = pattern;
    return this;
  }

  execute(callback: (args: Record<string, any>, context?: ToolContext) => MaybePromise<any>): this {
    this.#execute = callback;
    return this;
  }

  action(callback: MessageCommand.Callback<RegisteredAdapter>): this {
    this.#commandCallback = callback;
    return this;
  }

  #buildParameters(): ToolParametersSchema {
    const properties: Record<string, PropertySchema> = {};
    const required: string[] = [];
    
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

  #generatePattern(): string {
    if (this.#commandConfig.pattern) {
      return this.#commandConfig.pattern;
    }
    
    const parts: string[] = [this.#name];
    
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

    if (this.#platforms.length > 0) tool.platforms = this.#platforms;
    if (this.#scopes.length > 0) tool.scopes = this.#scopes;
    if (this.#permissionLevel !== 'user') tool.permissionLevel = this.#permissionLevel;
    if (this.#permissions.length > 0) tool.permissions = this.#permissions;
    if (this.#tags.length > 0) tool.tags = this.#tags;
    if (this.#hidden) tool.hidden = this.#hidden;
    if (this.#source) tool.source = this.#source;
    if (this.#keywords.length > 0) tool.keywords = this.#keywords;
    if (this.#preExecutable) tool.preExecutable = true;
    if (this.#kind) tool.kind = this.#kind;

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

  getActionCallback(): MessageCommand.Callback<RegisteredAdapter> | undefined {
    return this.#commandCallback;
  }

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

    if (this.#platforms.length > 0) json.platforms = this.#platforms;
    if (this.#scopes.length > 0) json.scopes = this.#scopes;
    if (this.#permissionLevel !== 'user') json.permissionLevel = this.#permissionLevel;
    if (this.#tags.length > 0) json.tags = this.#tags;

    return json;
  }

  get help(): string {
    const lines: string[] = [this.#generatePattern()];
    if (this.#description) lines.push(`  ${this.#description}`);
    
    if (this.#params.length > 0) {
      lines.push('  参数:');
      for (const param of this.#params) {
        const required = param.required ? '(必填)' : '(可选)';
        const desc = param.schema.description || '';
        lines.push(`    ${param.name}: ${param.schema.type} ${required} ${desc}`);
      }
    }
    
    if (this.#permissionLevel !== 'user') {
      lines.push(`  权限: ${this.#permissionLevel}`);
    }
    
    if (this.#platforms.length > 0) {
      lines.push(`  平台: ${this.#platforms.join(', ')}`);
    }
    
    if (this.#scopes.length > 0) {
      lines.push(`  场景: ${this.#scopes.join(', ')}`);
    }
    
    if (this.#commandConfig.usage?.length) {
      lines.push('  用法:');
      for (const u of this.#commandConfig.usage) {
        lines.push(`    ${u}`);
      }
    }
    
    if (this.#commandConfig.examples?.length) {
      lines.push('  示例:');
      for (const e of this.#commandConfig.examples) {
        lines.push(`    ${e}`);
      }
    }
    
    return lines.join('\n');
  }

  toString(): string {
    return `[ZhinTool: ${this.#name}] ${this.#description}`;
  }
}

export function isZhinTool(obj: any): obj is ZhinTool {
  return obj instanceof ZhinTool;
}

// ============================================================================
// ToolFeature 类型定义
// ============================================================================

/**
 * 工具输入类型（支持 Tool 对象或 ZhinTool 实例）
 */
export type ToolInput = Tool | ZhinTool;

/**
 * ToolContext 扩展方法类型
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
      tool: ToolFeature;
    }
  }
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 将 Tool 转换为 MessageCommand
 */
function toolToCommand(tool: Tool): MessageCommand<RegisteredAdapter> {
  const pattern = generatePattern(tool);
  const command = new MessageCommand<RegisteredAdapter>(pattern);
  
  command.desc(tool.description);
  
  if (tool.command && tool.command.usage) {
    command.usage(...tool.command.usage);
  }
  
  if (tool.command && tool.command.examples) {
    command.examples(...tool.command.examples);
  }
  
  if (tool.permissions?.length) {
    command.permit(...tool.permissions);
  }
  
  command.action(async (message: Message<AdapterMessage<RegisteredAdapter>>, result: MatchResult) => {
    const context: ToolContext = {
      platform: message.$adapter,
      botId: message.$bot,
      sceneId: message.$channel?.id || message.$sender.id,
      senderId: message.$sender.id,
      message,
    };
    
    const args = extractArgsFromMatchResult(result, tool.parameters);
    
    try {
      const response = await tool.execute(args, context);
      
      if (response === undefined || response === null) {
        return undefined;
      }
      
      if (typeof response === 'string') {
        return response;
      }
      
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
function commandToToolFn(
  command: MessageCommand<RegisteredAdapter>,
  pluginName: string
): Tool {
  const { pattern, helpInfo } = command;
  
  const parameters = parseCommandPattern(pattern);
  
  return {
    name: `cmd_${pattern.split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '_')}`,
    description: helpInfo.desc.join(' ') || `执行命令: ${pattern}`,
    parameters,
    source: `command:${pluginName}`,
    tags: ['command', pluginName],
    execute: async (args, context) => {
      const cmdParts = [pattern.split(' ')[0]];
      
      if (parameters.properties) {
        for (const [key, schema] of Object.entries(parameters.properties)) {
          if (args[key] !== undefined) {
            cmdParts.push(String(args[key]));
          }
        }
      }
      
      const cmdString = cmdParts.join(' ');
      
      if (context?.message) {
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
    command: false,
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
  
  if (result.params) {
    Object.assign(args, result.params);
  }
  
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
 */
function parseCommandPattern(pattern: string): ToolParametersSchema {
  const properties: Record<string, PropertySchema> = {};
  const required: string[] = [];
  
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
  
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// ============================================================================
// ToolFeature 实现
// ============================================================================

export class ToolFeature extends Feature<Tool> {
  readonly name = 'tool' as const;
  readonly icon = 'Wrench';
  readonly desc = '工具';

  /** 按名称索引 */
  readonly byName = new Map<string, Tool>();

  /** 工具对应的命令 */
  readonly toolCommands = new Map<string, MessageCommand<RegisteredAdapter>>();

  /** 工具到插件名的映射 */
  readonly #toolPluginMap = new Map<string, string>();

  /**
   * 添加工具
   * @param toolInput 工具或 ZhinTool 实例
   * @param pluginName 注册插件名
   * @param generateCommand 是否生成命令（默认 true）
   */
  addTool(toolInput: ToolInput, pluginName: string, generateCommand: boolean = true): () => void {
    const zhinTool = isZhinTool(toolInput) ? toolInput : null;
    const tool: Tool = zhinTool ? zhinTool.toTool() : toolInput as Tool;

    const toolWithSource: Tool = {
      ...tool,
      source: tool.source || `plugin:${pluginName}`,
      tags: [...(tool.tags || []), 'plugin', pluginName],
    };

    this.byName.set(tool.name, toolWithSource);
    this.#toolPluginMap.set(tool.name, pluginName);

    // 生成对应的命令
    if (generateCommand && tool.command !== false) {
      let command: MessageCommand<RegisteredAdapter>;
      
      const customCallback = zhinTool?.getActionCallback();
      if (customCallback) {
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
        
        command.action(customCallback);
      } else {
        command = toolToCommand(toolWithSource);
      }
      
      this.toolCommands.set(tool.name, command);
      
      const plugin = getPlugin();
      const commandService = plugin.root.inject('command');
      if (commandService) {
        commandService.add(command, pluginName);
      }
    }

    // Use Feature.add for item tracking
    const baseDispose = super.add(toolWithSource, pluginName);

    return () => {
      this.removeTool(tool.name);
      baseDispose();
    };
  }

  /**
   * 移除工具
   */
  removeTool(name: string): boolean {
    const tool = this.byName.get(name);
    if (!tool) return false;

    this.byName.delete(name);
    this.#toolPluginMap.delete(name);

    // 移除对应的命令
    const command = this.toolCommands.get(name);
    if (command) {
      const plugin = getPlugin();
      const commandService = plugin.root.inject('command');
      if (commandService) {
        commandService.remove(command);
      }
      this.toolCommands.delete(name);
    }

    // 移除 item
    super.remove(tool);
    return true;
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return [...this.items];
  }

  /**
   * 根据标签过滤工具
   */
  getByTags(tags: string[]): Tool[] {
    return this.items.filter(tool => 
      tags.some(tag => tool.tags?.includes(tag))
    );
  }

  /**
   * 执行工具
   */
  async execute(name: string, args: Record<string, any>, context?: ToolContext): Promise<any> {
    const tool = this.byName.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args, context);
  }

  /**
   * 将 Command 转换为 Tool
   */
  commandToTool(command: MessageCommand<RegisteredAdapter>, pluginName: string): Tool {
    return commandToToolFn(command, pluginName);
  }

  /**
   * 收集所有可用工具（包括从 Command 转换的）
   */
  collectAll(plugin: Plugin): Tool[] {
    const allTools: Tool[] = [];
    
    allTools.push(...this.getAll());
    
    const commandService = plugin.root.inject('command');
    if (commandService) {
      for (const command of commandService.items) {
        const isFromTool = Array.from(this.toolCommands.values()).includes(command);
        if (!isFromTool) {
          const toolFromCmd = commandToToolFn(command, 'command');
          allTools.push(toolFromCmd);
        }
      }
    }
    
    for (const [name, context] of plugin.root.contexts) {
      const adapterValue = context.value;
      if (adapterValue && typeof adapterValue === 'object' && 'getTools' in adapterValue) {
        const adapter = adapterValue as { getTools(): Tool[] };
        allTools.push(...adapter.getTools());
      }
    }
    
    return allTools;
  }

  /**
   * 根据上下文过滤工具
   */
  filterByContext(tools: Tool[], context: ToolContext): Tool[] {
    return tools.filter(tool => canAccessTool(tool, context));
  }

  /**
   * 按插件名获取工具
   */
  getToolsByPlugin(pluginName: string): Tool[] {
    const result: Tool[] = [];
    for (const [toolName, pName] of this.#toolPluginMap) {
      if (pName === pluginName) {
        const tool = this.byName.get(toolName);
        if (tool) result.push(tool);
      }
    }
    return result;
  }

  /**
   * 兼容旧接口：tools Map
   */
  get tools(): Map<string, Tool> {
    return this.byName;
  }

  /**
   * 序列化为 JSON
   */
  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(t => ({
        name: t.name,
        desc: t.description,
        platforms: t.platforms,
        tags: t.tags,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addTool(tool: ToolInput) {
        const plugin = getPlugin();
        const toolObj = isZhinTool(tool) ? tool.toTool() : tool as Tool;
        const dispose = feature.addTool(tool, plugin.name, true);
        plugin.recordFeatureContribution(feature.name, toolObj.name);
        plugin.onDispose(dispose);
        return dispose;
      },
      addToolOnly(tool: ToolInput) {
        const plugin = getPlugin();
        const toolObj = isZhinTool(tool) ? tool.toTool() : tool as Tool;
        const dispose = feature.addTool(tool, plugin.name, false);
        plugin.recordFeatureContribution(feature.name, toolObj.name);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}

// 导出类型和工具函数
export { 
  toolToCommand, 
  commandToToolFn as commandToTool,
  canAccessTool,
  inferPermissionLevel,
  hasPermissionLevel,
  PERMISSION_LEVEL_PRIORITY,
};
