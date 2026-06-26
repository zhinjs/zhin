
import {MessageChannel,Message} from "./message.js";
import {Adapter, Adapters} from "./adapter.js";
import { Endpoint } from "./endpoint.js";
import { SystemLog } from "./models/system-log.js";
import { User } from "./models/user.js";
import { Databases,Registry } from "@zhin.js/database";
import { MessageComponent } from "./message.js";
import { ProcessAdapter } from "./built/adapter-process.js";
import type { SenderRole } from "./built/roles.js";
export type { SenderRole } from "./built/roles.js";

export type ArrayItem<T>=T extends Array<infer R>?R:unknown
export interface Models extends Record<string,object>{
  SystemLog: SystemLog
  User: User,
}
export type MaybePromise<T> = [T] extends [Promise<infer U>] ? T|U : T|Promise<T>;
export interface RegisteredAdapters extends Adapters {
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
export type RegisteredAdapter=Extract<keyof RegisteredAdapters, string>
/**
 * 指定适配器的消息类型
 */
export type AdapterMessage<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?EndpointMessage<R>:{}
/**
 * 指定适配器的配置类型
 */
export type AdapterConfig<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?PlatformConfig<R>:Endpoint.Config
/**
 * Bot实例的配置类型
 */
export type PlatformConfig<T>=T extends Endpoint<infer L,infer R>?R:Endpoint.Config
/**
 * Bot实例的消息类型
 */
export type EndpointMessage<T extends Endpoint>=T extends Endpoint<infer R>?R:{}
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

/** $getMsg 返回的被引用消息载荷 */
export interface QuotedMessagePayload {
  messageId: string;
  sender?: { id?: string; name?: string };
  content: MessageElement[] | string;
  raw?: string;
  time?: number;
}

/** 支持按 message_id 拉取历史消息的 Bot（可选实现） */
export interface QuotableEndpoint {
  $getMsg(messageId: string): Promise<QuotedMessagePayload>;
}

/** 可选：编辑已发送消息（交互式棋盘更新） */
export interface EditMessageOptions {
  messageId: string;
  context: string;
  endpoint: string;
  id: string;
  type: 'private' | 'group' | 'channel';
  content: SendContent;
}

export interface EditableEndpoint {
  $editMessage?(options: EditMessageOptions): Promise<void>;
}

/** 出站回复来源（指令 / AI），仅当经 MessageDispatcher.replyWithPolish 发出时由框架填入异步上下文 */
export type OutboundReplySource = 'command' | 'ai'

/**
 * 出站润色上下文（`dispatcher.addOutboundPolish` 的 handler 签名的同构类型）。
 * 与 {@link Adapter.sendMessage} → `before.sendMessage` 同一管道；需 `message`/`source` 时见 `getOutboundReplyStore`（dispatcher 导出）。
 */
export interface OutboundPolishContext {
  message: Message
  content: SendContent
  source: OutboundReplySource
}

/** 返回 `SendContent` 则替换后续 `before.sendMessage` 与发送中的 content */
export type OutboundPolishMiddleware = (ctx: OutboundPolishContext) => MaybePromise<SendContent | void>
/**
 * 消息发送者信息
 */
export interface MessageSender{
  id: string;
  name?: string;
  permissions?:string[]
  /** 平台群成员身份（owner / admin / member）— 仅供 platform checker */
  role?: string;
  /** enrich 快照：endpoint 实例 master */
  isMaster?: boolean;
  /** enrich 快照：endpoint 实例 trusted */
  isTrusted?: boolean;
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

// PermissionService and ConfigService are now exported from their respective
// built files as backward-compatible aliases for PermissionFeature / ConfigFeature.
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
  endpoint:string
  content:SendContent
}

/** `Adapter.sendMessage` 成功发出后由 core 分发的载荷 */
export interface MessageSendPayload {
  adapter: string;
  options: SendOptions;
  messageId: string;
  /** 经 `replyWithPolish` 发出时由 dispatcher 填入 */
  replySource?: OutboundReplySource;
  /** 触发回复的入站消息（replyWithPolish 时可用） */
  replyMessage?: Message;
}

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
/** Message 通讯上下文上可经 resolveContextKey 自动注入的字段名 */
export type ContextInjectableKey = 'platform' | 'endpointId' | 'sceneId' | 'senderId' | 'scope';

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
  /**
   * 自动从 Message 通讯上下文注入的字段名（经 resolveContextKey 映射 $ 字段）。
   * 设置后该参数对 AI 隐藏，执行时自动从上下文填充。
   * 例如: contextKey: 'endpointId' → 执行时自动填入 message.$endpoint
   */
  contextKey?: ContextInjectableKey;
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
  /** 自动从 Message 注入的字段名（继承自 ToolJsonSchema） */
  contextKey?: ContextInjectableKey;
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
 * 文件操作角色 — 在 IM 场景中对文件操作的权限分级
 * - owner:  增删改查，敏感操作需二次确认
 * - admin:  增改查（无删），敏感操作需 Owner 确认
 * - user:   只查（读），危险操作直接拒绝
 */
export type FileRole = 'owner' | 'admin' | 'user';

/**
 * 标准化工具返回类型。
 * execute 可返回以下任一形式：
 * - string: 直接作为文本回复
 * - { text: string }: 结构化文本
 * - { data: unknown; format?: string }: 结构化数据
 * - void/null/undefined: 无回复
 * - Record / Array: 自动 JSON.stringify
 */
export type ToolResult = string | void | null | undefined | { text: string } | { data: unknown; format?: string } | Record<string, unknown> | unknown[];

/** 工具关联的聊天命令配置（可选；需自行 addCommand 注册） */
export interface ToolCommandConfig {
  pattern: string;
  alias?: string[];
  usage?: string | string[];
  examples?: string | string[];
}

/**
 * 统一的 Tool 定义（支持泛型参数类型推断）。
 *
 * @template TArgs 参数类型，默认 Record<string, any>
 *
 * @example
 * ```typescript
 * // 无泛型 — 兼容旧代码
 * const tool: Tool = { name: 'ping', ... };
 *
 * // 有泛型 — 通过 defineTool 获得类型安全
 * const tool = defineTool<{ city: string }>({
 *   name: 'weather',
 *   parameters: { type: 'object', properties: { city: { type: 'string', description: '城市' } }, required: ['city'] },
 *   execute: async (args) => args.city, // args.city 有类型提示
 * });
 * ```
 */
export interface Tool<TArgs extends Record<string, any> = Record<string, any>> {
  /** 工具名称（唯一标识，建议使用 snake_case） */
  name: string;
  
  /** 工具描述（供 AI 和帮助系统使用） */
  description: string;
  
  /** 参数定义（JSON Schema 格式） */
  parameters: ToolParametersSchema<TArgs>;
  
  /** 
   * 工具执行函数
   * @param args 解析后的参数
   * @param message 通讯上下文（入站 Message 或合成 Message）
   * @returns 执行结果
   */
  execute: (args: TArgs, message?: Message<any>) => MaybePromise<ToolResult>;
  
  /** 工具来源标识（自动填充：adapter:xxx / plugin:xxx） */
  source?: string;
  
  /** 工具标签（用于分类和过滤） */
  tags?: string[];

  /** 触发关键词（用户消息包含这些词时优先选择此工具） */
  keywords?: string[];
  
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
   * 是否隐藏
   * 隐藏的工具不会出现在帮助列表中，但仍可被调用
   */
  hidden?: boolean;

  /**
   * 是否允许预执行（opt-in）
   * 仅当设置为 true 时，Agent 才会在 LLM 调用前自动预执行此工具并将结果注入上下文。
   * 适用于无副作用的只读工具（如获取系统状态、读取配置等）。
   * 默认为 false，即不预执行。
   */
  preExecutable?: boolean;

  /** 工具分类（如 file / shell / web），用于展示与 TOOLS.md 协同 */
  kind?: string;

  /**
   * 可选：关联的 IM 命令模式（历史字段；需自行 addCommand 注册聊天命令）。
   * `false` 表示明确不暴露为命令。
   */
  command?: ToolCommandConfig | false;
}

/**
 * @deprecated 使用 `Tool<TArgs>` 替代。Tool 已原生支持泛型。
 */
export type ToolDefinition<TArgs extends Record<string, any> = Record<string, any>> = Tool<TArgs>;

export namespace Tool {
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
// 插件清单（plugin.yml）
// ============================================================================

/**
 * 插件清单元数据（从 plugin.yml 解析）
 */
export interface PluginManifest {
  /** 插件名称 */
  name: string;
  /** 插件描述 */
  description?: string;
  /** 插件版本 */
  version?: string;
}

// ============================================================================
// 兼容性别名（逐步废弃）
// ============================================================================

/** @deprecated 使用 Tool 替代 */
export type AITool = Tool;