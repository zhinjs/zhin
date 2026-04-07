/**
 * ToolFeature — 统一的工具管理服务
 * 工具仅面向 AI（通过 MCP 注册），不再与 Command 互转
 */
import { Feature, FeatureJSON } from "../feature.js";
import { Plugin, getPlugin } from "../plugin.js";
import type { Tool, ToolContext, ToolJsonSchema, ToolParametersSchema, PropertySchema, MaybePromise, ToolPermissionLevel, ToolScope } from "../types.js";

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
  tool: Tool<TArgs>
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
 * 提供链式调用风格来定义工具
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

  execute(callback: (args: Record<string, any>, context?: ToolContext) => MaybePromise<any>): this {
    this.#execute = callback;
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

    return tool;
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
    const lines: string[] = [this.#name];
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
  /** 添加工具 */
  addTool(tool: ToolInput): () => void;
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
// ToolFeature 实现
// ============================================================================

export class ToolFeature extends Feature<Tool> {
  readonly name = 'tool' as const;
  readonly icon = 'Wrench';
  readonly desc = '工具';

  /** 按名称索引 */
  readonly byName = new Map<string, Tool>();

  /** 工具到插件名的映射 */
  readonly #toolPluginMap = new Map<string, string>();

  /**
   * 添加工具（仅注册到 ToolFeature，不再生成 Command）
   * @param toolInput 工具或 ZhinTool 实例
   * @param pluginName 注册插件名
   */
  addTool(toolInput: ToolInput, pluginName: string): () => void {
    const zhinTool = isZhinTool(toolInput) ? toolInput : null;
    const tool: Tool = zhinTool ? zhinTool.toTool() : toolInput as Tool;

    const toolWithSource: Tool = {
      ...tool,
      source: tool.source || `plugin:${pluginName}`,
      tags: [...(tool.tags || []), 'plugin', pluginName],
    };

    this.byName.set(tool.name, toolWithSource);
    this.#toolPluginMap.set(tool.name, pluginName);

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
   * 生命周期: 销毁时清理所有工具
   */
  dispose(): void {
    this.byName.clear();
    this.#toolPluginMap.clear();
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
        const dispose = feature.addTool(tool, plugin.name);
        plugin.recordFeatureContribution(feature.name, toolObj.name);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}

// 导出类型和工具函数
export { 
  canAccessTool,
  inferPermissionLevel,
  hasPermissionLevel,
  PERMISSION_LEVEL_PRIORITY,
};
