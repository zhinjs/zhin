
import {MessageChannel,Message} from "./message.js";
import {Adapter} from "./adapter.js";
import {Bot} from "./bot.js";
import { SystemLog } from "./models/system-log.js";
import { User } from "./models/user.js";
import { Adapters } from "./adapter.js";
import { Databases,Registry } from "@zhin.js/database";
import { MessageComponent } from "./message.js";
import { ProcessAdapter } from "./built/adapter-process.js";

export type ArrayItem<T>=T extends Array<infer R>?R:unknown
export interface Models extends Record<string,object>{
  SystemLog: SystemLog
  User: User,
}
export type MaybePromise<T> = T extends Promise<infer U> ? T|U : T|Promise<T>;
export interface RegisteredAdapters {
  process: ProcessAdapter;
}
/**
 * 数据库配置类型，支持多种数据库驱动
 */
export type DatabaseConfig<T extends keyof Databases=keyof Databases>={
  dialect:T
} & Registry.Config[T]
/**
 * 获取对象所有value类型
 */
export type ObjectItem<T extends object>=T[keyof T]
/**
 * 已注册适配器名类型
 */
export type RegisteredAdapter=Extract<keyof Adapters, string>
/**
 * 指定适配器的消息类型
 */
export type AdapterMessage<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?BotMessage<R>:{}
/**
 * 指定适配器的配置类型
 */
export type AdapterConfig<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?PlatformConfig<R>:Bot.Config
/**
 * Bot实例的配置类型
 */
export type PlatformConfig<T>=T extends Bot<infer L,infer R>?R:Bot.Config
/**
 * Bot实例的消息类型
 */
export type BotMessage<T extends Bot>=T extends Bot<infer R>?R:{}
/**
 * 消息段结构，支持 text/image/at/face 等类型
 */
export interface MessageSegment {
  type: string;
  data: Record<string, any>;
}
export type MessageElement=MessageSegment|MessageComponent<any>
/**
 * 单个或数组类型
 */
export type MaybeArray<T>=T|T[]
/**
 * 消息发送内容类型
 */
export type SendContent=MaybeArray<string|MessageElement>
/**
 * 消息发送者信息
 */
export interface MessageSender{
  id: string;
  name?: string;
  permissions?:string[]
}
/**
 * 通用字典类型
 */
export type Dict<V=any,K extends string|symbol=string>=Record<K, V>;
/**
 * 用户信息结构
 */
export interface UserInfo {
  user_id: string;
  nickname: string;
  card?: string;
  role?: string;
}

/**
 * 权限服务接口
 */
import type { PermissionService } from './built/permission.js';
/**
 * 配置服务接口
 */
import type { ConfigService } from './built/config.js';

export { PermissionService, ConfigService };
/**
 * 群组信息结构
 */
export interface Group {
  group_id: string;
  group_name: string;
  member_count: number;
}

/** 消息中间件函数 */
export type MessageMiddleware<P extends RegisteredAdapter=RegisteredAdapter> = (message: Message<AdapterMessage<P>>, next: () => Promise<void>) => MaybePromise<void>;


/**
 * defineConfig辅助类型，支持函数式/对象式配置
 */
export type DefineConfig<T> = T | ((env:Record<string,string>)=>MaybePromise<T>);

export interface SendOptions extends MessageChannel{
  context:string
  bot:string
  content:SendContent
}

// export type PermissionChecker<T extends RegisteredAdapter = RegisteredAdapter> = (name: string, message: Message<AdapterMessage<T>>) => MaybePromise<boolean>
// export type PermissionItem<T extends RegisteredAdapter = RegisteredAdapter> = {
//    name: string | RegExp
//    check: PermissionChecker<T>
// }
export interface ProcessMessage {
  type: string;
  pid?: number;
  body: any;
}
export type QueueItem = {
  action: string;
  payload: any;
};
export type BeforeSendHandler=(options:SendOptions)=>MaybePromise<SendOptions|void>

// ============================================================================
// 统一 Tool 类型定义
// 支持 AI Agent 调用和自动转换为 Command
// ============================================================================

/**
 * JSON Schema 定义，用于描述工具参数
 */
export interface ToolJsonSchema {
  type: string;
  properties?: Record<string, ToolJsonSchema & { 
    /** 参数类型提示，用于命令解析 */
    paramType?: 'text' | 'number' | 'boolean' | 'rest';
  }>;
  required?: string[];
  items?: ToolJsonSchema;
  enum?: any[];
  description?: string;
  default?: any;
  [key: string]: any;
}

// ============================================================================
// 类型反射工具类型
// ============================================================================

/**
 * 从 TypeScript 类型推断 JSON Schema 的 type 字段
 */
type InferSchemaType<T> = 
  T extends string ? 'string' :
  T extends number ? 'number' :
  T extends boolean ? 'boolean' :
  T extends any[] ? 'array' :
  T extends object ? 'object' :
  'string';

/**
 * 单个属性的 Schema 定义
 */
export interface PropertySchema<T = any> extends ToolJsonSchema {
  type: InferSchemaType<T>;
  description?: string;
  default?: T;
  enum?: T extends string | number ? T[] : never;
  paramType?: 'text' | 'number' | 'boolean' | 'rest';
}

/**
 * 从 TArgs 构建 properties 类型
 * 每个属性的 key 必须与 TArgs 的 key 一致
 */
type ToolPropertiesSchema<TArgs extends Record<string, any>> = {
  [K in keyof TArgs]: PropertySchema<TArgs[K]>;
};

/**
 * 提取必需的属性名
 * 通过检查属性是否可以为 undefined 来判断
 */
type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

/**
 * 带类型反射的参数 Schema
 * @template TArgs 参数类型
 */
export interface ToolParametersSchema<TArgs extends Record<string, any> = Record<string, any>> {
  type: 'object';
  /** 属性定义，key 与 TArgs 的 key 一致 */
  properties: ToolPropertiesSchema<TArgs>;
  /** 必需的属性列表 */
  required?: (keyof TArgs & string)[];
  /** 描述 */
  description?: string;
}

/**
 * 工具执行上下文
 * 包含消息来源、发送者等信息
 */
export interface ToolContext {
  /** 来源平台 */
  platform?: string;
  /** 来源 Bot */
  botId?: string;
  /** 场景 ID（群号/频道ID/私聊用户ID） */
  sceneId?: string;
  /** 发送者 ID */
  senderId?: string;
  /** 原始消息对象（如果从消息触发） */
  message?: Message<any>;
  /** 
   * 消息场景类型
   * private: 私聊, group: 群聊, channel: 频道
   */
  scope?: ToolScope;
  /**
   * 发送者权限级别
   * 用于工具权限过滤
   */
  senderPermissionLevel?: ToolPermissionLevel;
  /**
   * 发送者是否为群管理员
   */
  isGroupAdmin?: boolean;
  /**
   * 发送者是否为群主
   */
  isGroupOwner?: boolean;
  /**
   * 发送者是否为机器人管理员
   */
  isBotAdmin?: boolean;
  /**
   * 发送者是否为 Zhin 拥有者
   */
  isOwner?: boolean;
  /** 额外数据 */
  extra?: Record<string, any>;
}

/**
 * 统一的 Tool 定义
 * 可同时用于：
 * - AI Agent 工具调用
 * - 自动生成 Command
 * - MCP 工具暴露
 * 
 * @example
 * ```typescript
 * // 使用 defineTool 获得类型安全
 * const weatherTool = defineTool<{ city: string }>({
 *   name: 'weather',
 *   description: '查询天气',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       city: { type: 'string', description: '城市名称' }
 *     },
 *     required: ['city']
 *   },
 *   execute: async (args) => {
 *     return `${args.city} 的天气是晴天`;  // args.city 有类型提示
 *   },
 * });
 * 
 * plugin.addTool(weatherTool);  // 无需类型断言
 * ```
 */
/**
 * 消息场景类型
 */
export type ToolScope = 'private' | 'group' | 'channel';

/**
 * 工具权限级别
 * - user: 普通用户（默认）
 * - group_admin: 群管理员
 * - group_owner: 群主
 * - bot_admin: 机器人管理员
 * - owner: Zhin 拥有者（最高权限）
 */
export type ToolPermissionLevel = 'user' | 'group_admin' | 'group_owner' | 'bot_admin' | 'owner';

export interface Tool {
  /** 工具名称（唯一标识，建议使用 snake_case） */
  name: string;
  
  /** 工具描述（供 AI 和帮助系统使用） */
  description: string;
  
  /** 
   * 参数定义（JSON Schema 格式）
   */
  parameters: ToolParametersSchema;
  
  /** 
   * 工具执行函数
   * @param args 解析后的参数
   * @param context 执行上下文（包含消息、发送者等信息）
   * @returns 执行结果（字符串会直接作为回复，对象会被 JSON 序列化）
   */
  execute: (args: Record<string, any>, context?: ToolContext) => MaybePromise<any>;
  
  /** 工具来源标识（自动填充：adapter:xxx / plugin:xxx） */
  source?: string;
  
  /** 工具标签（用于分类和过滤） */
  tags?: string[];
  
  /** 
   * 命令配置（可选）
   * 如果不提供，会根据 parameters 自动生成命令模式
   * 如果设置为 false，则不生成命令
   */
  command?: Tool.CommandConfig | false;
  
  /** 
   * 权限要求（旧版，保留兼容）
   * 执行此工具需要的权限列表
   */
  permissions?: string[];
  
  /**
   * 支持的平台列表
   * 例如：['qq', 'telegram', 'discord']
   * 不填则支持所有平台
   */
  platforms?: string[];
  
  /**
   * 支持的场景列表
   * 例如：['private', 'group', 'channel']
   * 不填则支持所有场景
   */
  scopes?: ToolScope[];
  
  /**
   * 调用所需的最低权限级别
   * 默认为 'user'（普通用户可调用）
   */
  permissionLevel?: ToolPermissionLevel;
  
  /**
   * 是否隐藏
   * 隐藏的工具不会出现在帮助列表中，但仍可被调用
   */
  hidden?: boolean;
}

/**
 * 类型安全的 Tool 定义（用于 defineTool）
 * 提供泛型参数以获得 execute 函数的类型推断
 */
export interface ToolDefinition<TArgs extends Record<string, any> = Record<string, any>> {
  name: string;
  description: string;
  parameters: ToolParametersSchema<TArgs>;
  execute: (args: TArgs, context?: ToolContext) => MaybePromise<any>;
  source?: string;
  tags?: string[];
  command?: Tool.CommandConfig | false;
  permissions?: string[];
  /** 支持的平台列表（不填则支持所有平台） */
  platforms?: string[];
  /** 支持的场景列表（不填则支持所有场景） */
  scopes?: ToolScope[];
  /** 调用所需的最低权限级别（默认 'user'） */
  permissionLevel?: ToolPermissionLevel;
  hidden?: boolean;
}

export namespace Tool {
  /**
   * 命令配置
   */
  export interface CommandConfig {
    /** 
     * 自定义命令模式
     * 如果不提供，会根据 parameters 自动生成
     * @example 'weather <city>' | 'calc <expression:text>'
     */
    pattern?: string;
    
    /** 命令别名 */
    alias?: string[];
    
    /** 命令使用说明 */
    usage?: string[];
    
    /** 命令示例 */
    examples?: string[];
    
    /** 是否启用（默认 true） */
    enabled?: boolean;
  }
  
  /**
   * 参数信息
   */
  export interface ParamInfo {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    default?: any;
    enum?: any[];
  }
}

// ============================================================================
// 兼容性别名（逐步废弃）
// ============================================================================

/** @deprecated 使用 Tool 替代 */
export type AITool = Tool;