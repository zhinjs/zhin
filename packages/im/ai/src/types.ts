/**
 * @zhin.js/ai - AI Service Types
 * 统一的 AI 服务类型定义
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'tool_call' | 'tool_result';

/** 会话记忆消息（text-only；多模态入站走 canonical Segment，不经此模型）。 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string | null;
  /** Some OpenAI-compatible providers (e.g. Cloudflare GLM) use `reasoning` instead of `reasoning_content`. */
  reasoning?: string | null;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
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
  [key: string]: any;  
}

/** 用量统计 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ============================================================================
// Provider 类型
// ============================================================================

/** A text-only callback borrowed from the caller's already selected operation.
 * It has no model directory, credentials, discovery, health check or fallback. */
export interface TextCompletionPort {
  completeText(system: string, user: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<string>;
}

/** `completeTextResult` 的返回：正文、实际作答的模型与用量。 */
export interface TextCompleteResult {
  text: string;
  model: string;
  usage?: import('./llm/types/agent-message.js').TokenUsage;
}

// ============================================================================
// Tool Context (generic, IM-free)
// ============================================================================

/**
 * 通用工具执行上下文。
 *
 * 定义了平台无关的字段；IM 侧使用 @zhin.js/core 的 Message 通讯上下文。
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

/** 工具执行上下文（协作取消 / 追踪；由运行时注入，工具可实现方可选消费）。 */
export interface AgentToolExecutionContext {
  readonly signal?: AbortSignal;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
}

/** Agent 工具 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (
    args: Record<string, any>,
    context?: any,
    executionContext?: AgentToolExecutionContext,
  ) => Promise<unknown>;
  /** 工具来源（如 builtin / plugin:xxx），用于冲突诊断与命名策略 */
  source?: string;
  /** 工具标签，用于分类和快速匹配 */
  tags?: string[];
  /** 触发关键词，用户消息包含这些词时优先选择此工具 */
  keywords?: string[];
  /** permit 门禁字符串（如 role(master)） */
  permissions?: readonly string[];
  /** 是否允许预执行（opt-in），默认 false */
  preExecutable?: boolean;
  /** 工具执行超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 工具分类（如 file / shell / web），用于 formatToolTitle 等展示 */
  kind?: string;
  /**
   * 该工具是否为只读操作（如 read_file, grep, list_dir）。
   * 只读工具可以安全并发执行。
   */
  isReadOnly?: boolean;
  /**
   * 该工具是否可以与其他工具并发执行。
   * 默认行为：isReadOnly 为 true 的工具自动视为并发安全。
   * 设为 false 可强制独占执行（如写文件、发送消息）。
   */
  isConcurrencySafe?: boolean;
  /** Per-tool approval policy (ADR 0039 P1); stacks with ExecPolicy. */
  requiresApproval?: import('./tool-policy.js').ToolApprovalPolicy;
  /** Hard-gate risk (ADR 0036): `dangerous` always needs fresh human approval, independent of ExecPolicy. */
  risk?: 'dangerous' | 'safe';
  /** Dangerous category: member / publish / funds / identity. */
  riskCategory?: 'member' | 'publish' | 'funds' | 'identity';
  /** Shapes tool output before it enters model context (IM rich payload may differ). */
  toModelOutput?: import('./tool-policy.js').ToolToModelOutputFn;
  /** Generation stamp — set when tools are collected; ToolRuntime validates before execution. */
  generation?: number;
}

/**
 * 工具过滤选项
 * 在 Agent.run() / runStream() 中启用程序化工具预过滤，
 * 省去额外的 AI 意图分析往返
 */
export interface ToolFilterOptions {
  /** 最大返回工具数量 (默认 10) */
  maxTools?: number;
  /** 最低相关性得分阈值，低于此分数的工具被过滤掉 (默认 0.1) */
  minScore?: number;
}

/** 工具结果在进入消息历史前可由宿主改写（如 Owner 硬编排）。IM 无关。 */
export interface ToolResultTransformInput {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  /** 工具返回的字符串（已 stringify） */
  result: string;
}

export type ToolResultTransform = (input: ToolResultTransformInput) => Promise<string>;

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
   */
  maxConcurrentTools?: number;
  /**
   * 每轮 LLM 调用的超时时间（毫秒，默认 60000）。
   * 此超时应用于 Agent 循环中的每一次 LLM 请求，而非所有轮次共享。
   */
  turnTimeout?: number;
  /** 受保护工具名（内置/保留名），后续同名注册将被忽略 */
  reservedToolNames?: string[];
  /** 受保护工具名前缀 */
  reservedToolNamePrefixes?: string[];
  /**
   * 在每条工具结果写入对话前调用（含 run / runStream）。
   * 用于 Owner 确认注入等编排；应保持幂等、避免长时间阻塞整批并发工具。
   */
  transformToolResult?: ToolResultTransform;
  /** 每轮 tool 执行后强制 micro-compact（toolSearch Worker 路径） */
  forceMicroCompactEachTurn?: boolean;
  /**
   * 同一轮对话内累计多少次「策略/安全拒绝」后强制结束工具循环（默认 2）。
   * 设为 0 表示禁用熔断。
   */
  policyDenialStopAfter?: number;
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
  /** 实际完成请求的模型（含 modelFallbacks 降级后） */
  model?: string;
  /** 压缩统计（仅当 contextWindow 开启时有值） */
  compaction?: {
    microSavedTokens: number;
    autoSavedTokens: number;
    compactCount: number;
  };
}

// ============================================================================
// AI Service 配置
// ============================================================================

/** Neutral execution-tuning values; no Provider, Account or credential authority. */
export interface ModelHarnessOverride {
  maxIterations?: number;
  /** 连续只读探索调用达到该次数时注入提示；0 关闭 */
  explorationBudget?: number;
  /** 在系统提示中加入"先规划、限定目标文件"的探索纪律 */
  explorationGuidance?: boolean;
  /** 每次有进展时延长的步数（覆盖 toolBudget.extendBy） */
  iterationExtension?: number;
  /** 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） */
  maxTotalIterations?: number;
  /** 空回复（无文本且无工具调用）时额外重试次数；默认 0 */
  emptyReplyRetries?: number;
  /** 单次模型请求超时（毫秒）；0 关闭 */
  requestTimeoutMs?: number;
}

export interface ModelHarnessConfig {
  services?: Record<string, { defaults?: ModelHarnessOverride; models?: Record<string, ModelHarnessOverride> }>;
}

/**
 * Ambient group engagement: for a group message that did not address the bot, a judge model
 * decides whether the bot would naturally chime in. Addressed messages always reach the Agent.
 */
export interface AmbientEngagementConfig {
  /** Groups that may be joined unprompted, as `platform:groupId`; `*` for every group. Default: none. */
  conversations?: string[];
  /**
   * Outside a conversation, judge a group at most this often (default 30000), to spare the judge's quota.
   * A burst inside the window is deferred until it ends (a newer message supersedes it), not dropped.
   */
  judgeIntervalMs?: number;
  /** Wait for the group to be quiet this long before judging a burst of messages (default 4000). */
  quietMs?: number;
  /** Minimum gap between two unprompted interjections in a group (default 120000). */
  cooldownMs?: number;
  /** Unprompted interjections per group per rolling hour (default 3). */
  maxPerHour?: number;
  /**
   * After the bot spoke (addressed or not) the group is in a conversation with it for this long
   * (default 180000): replies there skip the interjection cooldown and hourly cap; the judge still decides.
   */
  conversationWindowMs?: number;
  /** Judge confidence required to engage, 0..1 (default 0.7). */
  minConfidence?: number;
  /** `shadow` logs the judgment without replying (default `active`). */
  mode?: 'active' | 'shadow';
}

/**
 * Scene-event wake (#996): high-priority social events (bot muted, join request, member joined/left,
 * notice updated, bot poked) wake one light Agent turn without waiting for the next human message.
 * Low-priority events (reactions, card/title changes, person-to-person pokes) never wake on their own;
 * they appear in the next turn's ephemeral `[Scene events]` block.
 */
export interface SceneEventWakeConfig {
  /**
   * Groups/channels whose high-priority events may wake the bot, as `platform:sceneId`; `*` for all.
   * Default: the `ai.trigger.ambient.conversations` list (none when that is unset).
   */
  conversations?: string[];
  /** Coalesce window per scene in ms, clamped to 3000–5000 (default 4000). */
  coalesceMs?: number;
  /** Minimum gap between two wakes in one scene in ms (default 15000). */
  minIntervalMs?: number;
}

export interface WorkroomModelProcessingConfig {
  /** Exact processor endpoint covered by this contract. */
  endpoint: string;
  owner?: string;
  trustDomain?: string;
  processingRegions: string[];
  maxConfidentiality: 'public' | 'project_internal' | 'confidential' | 'restricted';
  external: boolean;
  /** Must be true for external Workroom planning. Configure provider-side enforcement separately. */
  noTraining: boolean;
  loggingMode: 'disabled' | 'metadata_only' | 'full';
  maximumRetentionSeconds: number;
  allowsRedisclosure: boolean;
  supportsDeletion: boolean;
}
