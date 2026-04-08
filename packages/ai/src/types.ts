/**
 * @zhin.js/ai - AI Service Types
 * 统一的 AI 服务类型定义
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'tool_call' | 'tool_result';

/** 聊天消息 */
export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** 内容部分（支持多模态） */
export type ContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'audio'; audio: { data: string; format: 'wav' | 'mp3' } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'face'; face: { id: string; text?: string } };

/** 工具调用 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** 工具定义 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** JSON Schema */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  /** JSON Schema allows arbitrary extension properties */
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON Schema spec requires open index
}

// ============================================================================
// 请求/响应类型
// ============================================================================

/** 聊天补全请求 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  /** 是否启用模型思考（如 qwen3 的 <think> 模式）。设为 false 可跳过思考加速响应。 */
  think?: boolean;
}

/** 聊天补全响应 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
}

/** 选择 */
export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

/** 用量统计 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ============================================================================
// 流式响应类型
// ============================================================================

/** 流式响应块 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: Usage;
}

/** 流式选择 */
export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ============================================================================
// Provider 类型
// ============================================================================

/** Provider 能力声明 */
export interface ProviderCapabilities {
  vision?: boolean;
  streaming?: boolean;
  toolCalling?: boolean;
  thinking?: boolean;
}

/** Provider 配置 */
export interface ProviderConfig {
  apiKey?: string;
  /**
   * Authorization 头前缀。默认 `'Bearer '`；设为 `''` 时仅用 apiKey 作为值（部分 API 要求 `Authorization: <key>`）。
   */
  authScheme?: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  /** 上下文窗口大小（token 数），各 Provider 映射到自身参数 */
  contextWindow?: number;
  /** Provider 能力声明 */
  capabilities?: ProviderCapabilities;
}

/** Provider 接口 */
export interface AIProvider {
  name: string;
  models: string[];
  
  /** 聊天补全 */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  
  /** 流式聊天补全 */
  chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  
  /** 列出可用模型 */
  listModels?(): Promise<string[]>;
  
  /** 检查连接 */
  healthCheck?(): Promise<boolean>;

  /** 上下文窗口大小（token 数），由 Provider 实现暴露 */
  contextWindow?: number;

  /** Provider 能力声明 */
  capabilities?: ProviderCapabilities;
}

// ============================================================================
// Tool Context (generic, IM-free)
// ============================================================================

/**
 * 通用工具执行上下文。
 *
 * 定义了平台无关的字段，IM 应用通过 core 的 IMToolContext 扩展。
 * 非 IM 应用可直接使用此接口。
 */
export interface ToolContext {
  /** 来源平台标识 */
  platform?: string;
  /** 发送者 ID */
  senderId?: string;
  /** 场景 / 频道 ID */
  sceneId?: string;
  /** 额外数据（应用自行扩展） */
  [key: string]: unknown;
}

// ============================================================================
// Agent 类型
// ============================================================================

/** Agent 工具 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, any>) => Promise<unknown>;
  /** 工具标签，用于分类和快速匹配 */
  tags?: string[];
  /** 触发关键词，用户消息包含这些词时优先选择此工具 */
  keywords?: string[];
  /** 所需权限级别 (0=所有人, 1=群管理, 2=群主, 3=Bot管理员, 4=拥有者) */
  permissionLevel?: number;
  /** 是否允许预执行（opt-in），默认 false */
  preExecutable?: boolean;
  /** 工具执行超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 工具分类（如 file / shell / web），用于 formatToolTitle 等展示 */
  kind?: string;
  /**
   * 该工具是否为只读操作（如 read_file, grep, list_dir）。
   * 只读工具可以安全并发执行。
   * 参考 Claude Code Tool.isReadOnly 模式。
   */
  isReadOnly?: boolean;
  /**
   * 该工具是否可以与其他工具并发执行。
   * 默认行为：isReadOnly 为 true 的工具自动视为并发安全。
   * 设为 false 可强制独占执行（如写文件、发送消息）。
   * 参考 Claude Code Tool.isConcurrencySafe 模式。
   */
  isConcurrencySafe?: boolean;
}

/**
 * 工具过滤选项
 * 在 Agent.run() / runStream() 中启用程序化工具预过滤，
 * 省去额外的 AI 意图分析往返
 */
export interface ToolFilterOptions {
  /** 调用者权限级别 (0-4)，高于工具要求才能使用 */
  callerPermissionLevel?: number;
  /** 最大返回工具数量 (默认 10) */
  maxTools?: number;
  /** 最低相关性得分阈值，低于此分数的工具被过滤掉 (默认 0.1) */
  minScore?: number;
}

/** Agent 配置 */
export interface AgentConfig {
  provider: string;
  model?: string;
  /** 降级候选模型列表（按优先级排序），主模型失败时依次尝试 */
  modelFallbacks?: string[];
  systemPrompt?: string;
  tools?: AgentTool[];
  maxIterations?: number;
  temperature?: number;
  /**
   * 上下文窗口大小（tokens），用于循环内自动压缩判断。
   * 设置后每轮循环入口会执行 Micro-Compact + Auto-Compact。
   * 不设置则禁用循环内压缩。
   */
  contextWindow?: number;
  /**
   * 最大并发工具执行数（默认 10）。
   * 参考 Claude Code StreamingToolExecutor 的并发上限。
   */
  maxConcurrentTools?: number;
  /**
   * 每轮 LLM 调用的超时时间（毫秒，默认 60000）。
   * 此超时应用于 Agent 循环中的每一次 LLM 请求，而非所有轮次共享。
   */
  turnTimeout?: number;
}

/** Agent 运行结果 */
export interface AgentResult {
  content: string;
  toolCalls: {
    tool: string;
    args: Record<string, any>;
    result: any;
  }[];
  usage: Usage;
  iterations: number;
  /** 压缩统计（仅当 contextWindow 开启时有值） */
  compaction?: {
    microSavedTokens: number;
    autoSavedTokens: number;
    compactCount: number;
  };
}

// ============================================================================
// Session 类型
// ============================================================================

/** 会话配置 */
export interface SessionConfig {
  provider: string;
  model?: string;
  systemPrompt?: string;
  maxHistory?: number;
  expireMs?: number;
}

/** 会话 */
export interface Session {
  id: string;
  config: SessionConfig;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

// ============================================================================
// AI Service 配置
// ============================================================================

/** Ollama-specific fields for AIConfig typing (mirrors OllamaConfig) */
export interface OllamaProviderConfig extends ProviderConfig {
  host?: string;
  models?: string[];
  num_ctx?: number;
}

/** AI 服务配置 */
export interface AIConfig {
  enabled?: boolean;
  defaultProvider?: string;
  providers?: {
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    deepseek?: ProviderConfig;
    moonshot?: ProviderConfig;
    zhipu?: ProviderConfig;
    ollama?: OllamaProviderConfig;
    custom?: ProviderConfig[];
  };
  sessions?: {
    /** 最大历史消息数（数据库模式默认200，内存模式默认100） */
    maxHistory?: number;
    /** 会话过期时间（毫秒，数据库模式默认7天，内存模式默认24小时） */
    expireMs?: number;
    /** 是否使用数据库持久化存储（默认 true） */
    useDatabase?: boolean;
  };
  context?: {
    /** 是否启用消息记录（默认 true） */
    enabled?: boolean;
    /** 读取的最近消息数量（默认 100） */
    maxRecentMessages?: number;
    /** 触发总结的消息数量阈值（默认 50） */
    summaryThreshold?: number;
    /** 总结后保留的消息数量（默认 10） */
    keepAfterSummary?: number;
    /** 上下文最大 token 估算（默认 4000） */
    maxContextTokens?: number;
    /** 自定义总结提示词 */
    summaryPrompt?: string;
  };
  /** Agent 工具开关与执行安全 */
  agent?: {
    /** 禁用的工具名列表，这些工具不会下发给 AI */
    disabledTools?: string[];
    /** 仅允许的工具名列表；若设置则只下发列表中的工具（与 disabledTools 二选一，allowedTools 优先） */
    allowedTools?: string[];
    /** bash 执行策略：deny=禁止执行，allowlist=仅允许列表内命令，full=不限制 */
    execSecurity?: 'deny' | 'allowlist' | 'full';
    /** 预设命令白名单模式：readonly / network / development / custom（默认 custom，使用自定义 execAllowlist） */
    execPreset?: 'readonly' | 'network' | 'development' | 'custom';
    /** allowlist 模式下允许的命令（支持正则字符串，如 "^ls "、"^cat "），与 preset 合并 */
    execAllowlist?: string[];
    /** allowlist 未命中时：true=需审批（当前实现为拒绝并提示），false=直接拒绝 */
    execAsk?: boolean;
  };
  /** AI 触发配置 */
  trigger?: {
    /** 是否启用（默认 true） */
    enabled?: boolean;
    /** 触发前缀列表（默认 ['#', 'AI:']） */
    prefixes?: string[];
    /** 是否响应 @ 机器人（默认 true） */
    respondToAt?: boolean;
    /** 是否响应私聊（默认 true） */
    respondToPrivate?: boolean;
    /** 触发关键词（可选） */
    keywords?: string[];
    /** 忽略的前缀（命令前缀，避免与命令冲突，默认 ['/', '!', '！']） */
    ignorePrefixes?: string[];
    /** 超时时间（毫秒，默认 60000） */
    timeout?: number;
    /** 思考中提示语（可选，设置后会在处理前发送） */
    thinkingMessage?: string;
    /** 错误提示模板（默认 '❌ AI 处理失败: {error}'） */
    errorTemplate?: string;
  };
}
