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

/** Provider 能力声明 */
export interface ProviderCapabilities {
  /** Explicit model input modalities. Absence is text-only (fail closed), except Gemini chat models on `sdk: google` (see `defaultModelInput`). */
  input?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[];
  streaming?: boolean;
  toolCalling?: boolean;
  thinking?: boolean;
}

/** Provider 配置 */
export interface ProviderConfig {
  apiKey?: string;
  /**
   * Authorization 头方案。不写时用各 SDK 默认（OpenAI 系 `Bearer`，Anthropic `x-api-key`，Google `x-goog-api-key`）；
   * 设为 `''` 时 `Authorization: <key>`；设为 `'Bearer'` / `'Token'` 等时 `Authorization: <scheme> <key>`（结尾空格可有可无）。
   */
  authScheme?: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: string[];
  /** 单次请求超时（ms），覆盖 `ai.providerResilience.requestTimeoutMs`；模型 harness 的 `requestTimeoutMs` 优先。0 关闭。 */
  timeout?: number;
  /** 每个模型的重试次数，覆盖 `ai.providerResilience.maxRetries`。 */
  maxRetries?: number;
  /** 流式请求首个 chunk 超时（ms，含等待响应头），默认关闭；超时按 timeout 重试 / 切换备用模型。 */
  firstChunkTimeoutMs?: number;
  /** 流式请求两个 chunk 之间的静默超时（ms），默认关闭。 */
  chunkTimeoutMs?: number;
  headers?: Record<string, string>;
  /** 上下文窗口大小（token 数），各 Provider 映射到自身参数 */
  contextWindow?: number;
  /** 每次请求的输出 token 上限，默认 8192；Gemini/Claude 的思考 token 也计入 */
  maxOutputTokens?: number;
  /** 思考深度：`off` | `low` | `medium` | `high`；不填用 provider 默认；`providerOptions` 里的思考设置优先 */
  thinkingLevel?: import('./llm/types/agent-event.js').ThinkingLevel;
  /** Provider 能力声明 */
  capabilities?: ProviderCapabilities;
  /** Explicit model input modalities. Prefer this over inferred provider identity. */
  input?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[];
  /**
   * Extra AI SDK `providerOptions`, merged into every request of this provider,
   * keyed by SDK provider id. For Gemini: `{ google: { safetySettings: [...],
   * thinkingConfig: { thinkingLevel: 'low' } } }`. See ai.google.dev safety settings.
   */
  providerOptions?: Record<string, Record<string, import('ai').JSONValue>>;
  /** Gemini context caching (`sdk: google`): `{ mode: 'explicit', ttlSeconds }`. Default implicit. */
  contextCache?: import('./llm/gemini-context-cache.js').GeminiContextCacheConfig;
  /** 文生图默认（zhipu / cloudflare 等支持 generateImage 的 driver） */
  imageGeneration?: import('./image-generation.js').ImageGenerationDefaults;
}

/** 纯文本补全选项（摘要 / 判定等轻量场景）。 */
export interface TextCompleteOptions {
  /** 缺省用 provider 配置的 `defaultModel`，否则 provider.models[0]。 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 调用方取消信号；中止后不再重试 / fallback，直接抛出。 */
  signal?: AbortSignal;
  /**
   * 单次请求超时（ms），覆盖 `resilience.requestTimeoutMs`。
   * 缺省与主对话路径一致（180s）；`0` 关闭超时。
   */
  timeoutMs?: number;
  /** 主模型重试耗尽后依次尝试的同 provider 模型 id。 */
  fallbackModels?: readonly string[];
  /** 重试 / 退避 / 超时 / fallback 配置，与主对话路径的 `providerResilience` 同形。 */
  resilience?: import('./llm/provider-resilience.js').ProviderResilienceConfig;
}

/** `completeTextResult` 的返回：正文、实际作答的模型（fallback 后可能不同）与用量。 */
export interface TextCompleteResult {
  text: string;
  model: string;
  usage?: import('./llm/types/agent-message.js').TokenUsage;
}

/**
 * Provider 接口。
 *
 * 传输面只有两类：结构化 agent 会话走 owner-scoped `LlmApiRuntime`；
 * 轻量"system+user→文本"补全走 `completeText`。不再有 OpenAI wire
 * 形态的 chat/chatStream 双轨。
 */
export interface AIProvider {
  name: string;
  models: string[];

  /** 纯文本补全：system + user → assistant 文本。 */
  completeText(system: string, user: string, opts?: TextCompleteOptions): Promise<string>;

  /** 同 `completeText`，另外返回实际作答的模型与用量（实现方可选）。 */
  completeTextResult?(system: string, user: string, opts?: TextCompleteOptions): Promise<TextCompleteResult>;

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

/** Ollama-specific fields for AIConfig typing (mirrors OllamaConfig) */
export interface OllamaProviderConfig extends ProviderConfig {
  host?: string;
  models?: string[];
  num_ctx?: number;
}

/** 命名 provider 实例（sdk + 连接参数，ADR 0018） */
export interface ProviderInstanceConfig extends ProviderConfig, OllamaProviderConfig {
  sdk: import('./llm/sdk-registry.js').SdkId;
}

/**
 * @deprecated Inbound routing by `match` never took effect (IM inbound always
 * uses the `zhin` binding). Accepted with a warning; removed in the next minor.
 */
export interface RouteMatchConfig {
  adapter?: string;
  endpoint?: string;
  scene?: string;
  hasMedia?: string[];
  contentContains?: string;
}

export interface AgentBindingConfig {
  provider: string;
  model: string;
  mcpServers?: string[];
  /** @deprecated 入站路由从未生效；启动时告警，`zhin config check --fix` 会删除。 */
  priority?: number;
  /** @deprecated 入站路由从未生效（含 hasMedia）；启动时告警，`zhin config check --fix` 会删除。 */
  match?: RouteMatchConfig;
  /** Agent 昵称（LLM 自称 + IM 协作展示，ADR 0024）。 */
  nickname?: string;
}

/** Per-model harness override (ai.agent.modelHarness.models / providerPatterns). */
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

export interface AIConfig {
  enabled?: boolean;
  /** Optional structured-decision service, selected by exact Plugin Runtime owner. */
  decisions?: {
    provider: string;
    skills?: DecisionTaskConfig;
    tools?: DecisionTaskConfig;
    memory?: DecisionTaskConfig;
    agents?: DecisionTaskConfig;
    approval?: DecisionTaskConfig;
    /** Unprompted group engagement (`ai.trigger.ambient`): decide whether the bot speaks up. */
    ambient?: DecisionTaskConfig;
  };
  /** Workroom control-plane policy. Project definitions remain in the persistent Catalog. */
  workroom?: {
    /** Authenticated Console principal ids allowed to publish shared Capability Packs. */
    trustedPackPublishers?: string[];
    /** Explicit P12 processor contracts used by authenticated disclosure bootstrap. */
    disclosure?: {
      /** Stable tenant boundary for Project data; defaults to `workroom:<projectId>`. */
      tenantId?: string;
      /** Contracts keyed by `ai.providers` alias. No privacy property is inferred. */
      modelProviders?: Record<string, WorkroomModelProcessingConfig>;
    };
  };
  /** 命名 provider 实例 */
  providers?: Record<string, ProviderInstanceConfig>;
  /** per-agent 绑定（协作角色如 researcher 亦用 agents.<role>）；IM 入站总是交给 zhin */
  agents?: Record<string, AgentBindingConfig>;
  /** Structured numeric usage records; independent of log/trace retention. */
  usage?: { /** Retention in days, default 30; positive integer. */ retentionDays?: number };
  /** Decision audit (`ai_decision_events`, ADR 0036); independent of log/trace retention. */
  audit?: { /** Retention in days, default 14; positive integer. */ retentionDays?: number };
  sessions?: {
    /** 最大历史消息数（数据库模式默认200，内存模式默认100） */
    maxHistory?: number;
    /** 会话过期时间（毫秒，数据库模式默认7天，内存模式默认24小时） */
    expireMs?: number;
    /** 是否使用数据库持久化存储（默认 true） */
    useDatabase?: boolean;
    /** 无摘要时冷启动最多条数（默认 50） */
    coldStartMaxMessages?: number;
    /** 冷启动时间窗（毫秒，默认 24h） */
    coldStartMaxAgeMs?: number;
    /** 空闲后自动归档 active 会话（毫秒，默认 7 天；0=关闭） */
    sessionIdleArchiveMs?: number;
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
  /**
   * 文生图全局默认（可被 `providers.<alias>.imageGeneration` 覆盖）。
   * 智谱：`watermarkEnabled: false` 需先在智谱开放平台签署去水印免责声明。
   */
  imageGeneration?: import('./image-generation.js').ImageGenerationDefaults;
  /** 入站/出站多模态（base64 契约；平台 adapter 负责编解码与发送） */
  multimodal?: {
    enabled?: boolean;
    maxFileBytes?: number;
    inboundDir?: string;
    outboundDir?: string;
    image?: { maxDimension?: number; preferNativeVision?: boolean };
    audio?: { strategy?: 'transcribe' | 'mcp' | 'text-only' };
    video?: { strategy?: 'mcp' | 'text-only'; mcpServer?: string; maxFrames?: number };
    outbound?: { splitMessages?: 'auto' | 'single' | 'always_split' };
    /**
     * Perception pre-pass: when the turn's model cannot take an image / video / PDF,
     * this media-capable model describes it and the description is injected as
     * untrusted text (`[图片描述] …`). Unset = off (placeholders as before).
     */
    perception?: {
      /** `ai.providers` alias of the perception model. */
      provider: string;
      model: string;
      /** Kinds to describe. Default `['image']`; `file` covers PDFs only. */
      kinds?: Array<'image' | 'video' | 'file'>;
      /** Description length cap in characters. Default 800. */
      maxChars?: number;
      /** Per-attempt timeout in ms. Default 30000. */
      timeoutMs?: number;
      /** Media described per turn; the rest keep the placeholder. Default 4. */
      maxItemsPerTurn?: number;
    };
  };
  /**
   * 三层 Markdown 文件记忆（global / platform / session）。
   * 默认启用；设 enabled: false 可关闭注入。
   */
  memory?: {
    enabled?: boolean;
    /** L4 语义记忆：memory_entries 表 + memory_search/upsert 工具 */
    semantic?: {
      enabled?: boolean;
      autoConsolidate?: boolean;
      /**
       * Per-turn recall (#734): BM25 top-k entries relevant to the current
       * message are added to the turn context. Default on when semantic memory
       * is enabled; topK 5, maxTokens 400.
       */
      recall?: {
        enabled?: boolean;
        topK?: number;
        maxTokens?: number;
      };
    };
    budgets?: {
      session?: number;
      platform?: number;
      global?: number;
      daily?: number;
    };
  };
  /**
   * 本地知识库（knowledge_search 工具数据源）。
   * 放置 .md / .txt 文件到 baseDir，Agent 可通过 knowledge_search 工具检索。
   */
  knowledge?: {
    /** 项目根目录内的知识库目录路径。配置该段时必须显式声明。 */
    baseDir: string;
  };
  /** PAT for adapter-github auto-registered server-github MCP (overrides env when set). */
  githubMcp?: {
    token?: string;
    /** 为 true 时注册 server-github MCP（PAT，人身份）；默认 false，Bot 写操作用 adapter github_* 工具 */
    enabled?: boolean;
  };
  /**
   * External MCP servers for the Agent MCP client (global, all bots).
   * Listed servers are exposed to ZhinAgent tool pool when connected.
   */
  mcpServers?: Array<{
    name: string;
    transport: 'stdio' | 'streamable-http' | 'sse';
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }>;
  /** Agent 工具开关与执行安全 */
  agent?: {
    /** Existing same-session ingress queue policy, reused by canonical Turn Intent resolution. */
    inboundQueue?: {
      groupMode?: 'supersede' | 'fifo';
      ttlMs?: number;
      coalesceWindowMs?: number;
      /** Turns allowed to wait behind the running turn of one session (default 5). */
      maxQueuedTurns?: number;
      /** ADR 0038: merge mentions from several group members into one reply. */
      merge?: {
        enabled?: boolean;
        quietMs?: number;
        maxWaitMs?: number;
        maxSenders?: number;
      };
      /** ADR 0038 §5: danmaku mode for adapters that declare `liveDanmaku`. */
      live?: {
        mode?: 'pick-one' | 'summary';
        windowMs?: number;
        minIntervalMs?: number;
      };
    };
    /** bash 执行策略：deny=禁止执行，allowlist=仅允许列表内命令，full=不限制 */
    execSecurity?: 'deny' | 'allowlist' | 'full';
    /** 预设命令白名单模式：readonly / network / development / custom（默认 custom，使用自定义 execAllowlist） */
    execPreset?: 'readonly' | 'network' | 'development' | 'custom';
    /**
     * IM 回合的出网权限（web_fetch / web_search 与联网命令）。默认关闭；`enabled: true` 时开放 HTTPS 出网，
     * `allowedDomains` 非空时只允许这些域名。未设置 `enabled` 时兼容旧行为：`execPreset: network` 视为开启。
     */
    network?: {
      enabled?: boolean;
      allowedDomains?: string[];
    };
    /**
     * IM 私聊里 master 能否使用 bash。默认 off：IM 会话不提供 bash。
     * isolated：仅 master 私聊开放，命令在 Docker 容器内执行（工作区可写、默认无网络、
     * development 白名单、白名单外命令需审批）。宿主没有可用 Docker 时执行会失败，不会降级到宿主机。
     */
    masterShell?: 'off' | 'isolated';
    /** IM / plugin-runtime 回合的子 Agent：sync 在当前回合内同步运行 spawn_task；off（默认）不提供 */
    subagentTurnMode?: 'off' | 'sync';
    /** 进度感知的工具调用预算：maxIterations 为软上限，有进展时自动延长；含硬上限与自动续跑 */
    toolBudget?: {
      extendBy?: number;
      progressWindow?: number;
      maxTotalIterations?: number;
      maxSubagentTotalIterations?: number;
      maxWallClockMs?: number;
      maxTotalTokens?: number;
      failureStreakLimit?: number;
      repeatLimit?: number;
      autoContinue?: 'off' | 'master_dm' | 'on';
      maxContinuations?: number;
      progressUpdates?: 'off' | 'private' | 'all';
      progressMinIntervalMs?: number;
      progressMaxUpdates?: number;
    };
    /** allowlist 模式下允许的命令（支持正则字符串，如 "^ls "、"^cat "），与 preset 合并 */
    execAllowlist?: string[];
    /** 审批方式：人工询问、独立审核 Agent，或跳过审批。 */
    execApprovalMode?: 'ask' | 'auto' | 'bypass';
    subagentExecApprovalMode?: 'ask' | 'auto' | 'bypass';
    workerExecApprovalMode?: 'ask' | 'auto' | 'bypass';
    /** @deprecated No effect (#735); `zhin config check --fix` removes it. */
    taskExecApprovalMode?: 'ask' | 'auto' | 'bypass';
    /** 观测主回合阶段日志（或通过 ZHIN_AGENT_PHASE_TRACE=1 开启） */
    phaseTrace?: boolean;
    /** 按模型 / provider 模式覆盖 model harness */
    modelHarness?: {
      /** 模型级覆盖：支持 "gpt-4o" 或 "openai:gpt-4o" */
      models?: Record<string, ModelHarnessOverride>;
      /** provider 模式覆盖（支持 * 通配符） */
      providerPatterns?: Record<string, ModelHarnessOverride>;
    };
    /** Provider 韧性：重试 / 退避 / 超时 / fallback（见 ProviderResilienceConfig，默认保守） */
    providerResilience?: import('./llm/provider-resilience.js').ProviderResilienceConfig;
    /** 注入防护：读取外部内容后的高危动作需确认；出站回复屏蔽系统提示 / 密钥 / 其他会话记忆泄露 */
    injectionGuard?: {
      confirmHighRisk?: 'external_content' | 'off';
      outboundCheck?: 'redact' | 'off';
      trustedOutputTools?: string[];
    };
    /**
     * 危险工具硬闸（ADR 0036）：始终开启，独立于 execApprovalMode。只能调高风险，不能关闭。
     * dangerous 工具每次都要新鲜的人工批准或 Console 已批准的同参数卡片；被拒即 fail closed。
     */
    toolHardGate?: {
      /** 额外标为 dangerous 的工具（本地名或限定名） */
      dangerousTools?: string[];
      /** 资金类工具是否可用；默认 false，开启后仍需审批 */
      allowFunds?: boolean;
      /** 审批等待上限（毫秒），超时拒绝；默认 300000 */
      approvalTimeoutMs?: number;
      /** 同一群同时待审批的卡片上限（ADR 0038）；超出 fail closed；默认 3 */
      maxPendingPerScene?: number;
      /**
       * IM 审批通道（#1013，默认关）：卡片同时投递给 allowlist 审批人，审批人私聊
       * `approve <id>` / `deny <id>` 结算，与 Console 共用审批队列；业务群消息不能结算。
       */
      imApproval?: {
        /** 默认 false */
        enabled?: boolean;
        /** 审批人平台用户 id：扁平列表对所有平台生效，或 `platform → userIds` */
        approverIds?: string[] | Record<string, string[]>;
        /** `dm`（默认）私聊审批人；`approver_group` 投递到 approverGroupId（不能是业务会话） */
        delivery?: 'dm' | 'approver_group';
        /** `delivery: approver_group` 时必填的专用审批群 id */
        approverGroupId?: string;
      };
    };
    /** 按用户 / 按群的 token 配额与群速率限制；默认全部关闭，主人默认不受限 */
    usageQuota?: {
      windowMs?: number;
      perUserTokens?: number;
      perGroupTokens?: number;
      perGroupRequestsPerMinute?: number;
      exemptOwner?: boolean;
    };
    /** Worker 侧 TF-IDF 载入 deferred 工具数量上限 */
    /** @deprecated No effect (#735); use `deferredTools.discoverTopK`. */
    deferredToolMaxResults?: number;
    /** 工具 schema 按需加载 */
    deferredTools?: {
      maxLoadedPerSession?: number;
      discoverTopK?: number;
      /** 额外常驻工具；默认在内置常驻集合基础上追加 */
      alwaysLoadedTools?: string[];
      /** `extend`（默认）追加到内置常驻集合；`replace` 完全替换 */
      alwaysLoadedMode?: 'extend' | 'replace';
      mcpServers?: Record<string, { alwaysLoaded?: string[] }>;
    };
    /** Deferred Worker 基础工具 */
    workerBaseTools?: string[];
    /**
     * AI 结构化输出（AI SDK Output.object）：
     * - false/缺省：纯文本回复（现状）；
     * - true | 'segments'：约束最终回复为 zhin AI 出站 JSON（text/mentions/segments 消息段数组）；
     * - 对象：自定义 JSON Schema 原样透传给模型。
     */
    outputSchema?: boolean | 'segments' | Record<string, unknown>;
  };
  /** AI 访问控制（平台 AIGC 合规；Endpoint 可用 aiAccess 覆盖） */
  access?: {
    /** open | closed | whitelist，默认 open */
    mode?: 'open' | 'closed' | 'whitelist';
    /** 允许触发 AI 的 sender.id */
    users?: string[];
    /** 允许触发 AI 的 group/channel id */
    groups?: string[];
    /** 私聊拒绝时的回复文案 */
    denyMessage?: string;
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
    /** 入口层错误提示模板（可选；不配置时用聊天口吻，主人额外看到原因） */
    errorTemplate?: string;
    /** 群聊旁听：没人叫机器人时，由判断模型决定是否接话 */
    ambient?: AmbientEngagementConfig;
    /** 状态感知（#996）：禁言/入群申请/成员进出/公告/戳 Bot 等高优先社交事件可独立唤醒回合 */
    sceneEvents?: SceneEventWakeConfig;
  };
}

/**
 * Ambient group engagement: for a group message that did not address the bot, a judge model
 * decides whether the bot would naturally chime in. Addressed messages always reach the Agent.
 */
export interface AmbientEngagementConfig {
  /** Groups that may be joined unprompted, as `platform:groupId`; `*` for every group. Default: none. */
  conversations?: string[];
  /**
   * Judge model as `providerAlias/model`, or a list tried in order when one fails or is rate
   * limited (free tiers are limited per model). Default: the main Agent's model.
   * With `ai.decisions.ambient` in `active` mode the decision provider judges first and this list
   * becomes its fallback; in `shadow` mode this list still decides.
   */
  judge?: string | string[];
  /** Outside a conversation, judge a group at most this often (default 30000), to spare the judge's quota. */
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

/** Consumer policy; the decision transport itself remains independent of Agent/IM. */
export interface DecisionTaskConfig {
  readonly mode: 'off' | 'shadow' | 'active';
  readonly timeoutMs?: number;
  readonly minConfidence?: number;
  readonly topK?: number;
  readonly maxCandidates?: number;
  readonly maxSelections?: number;
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
