import type { AmbientEngagementConfig, SceneEventWakeConfig, ModelHarnessConfig, ProviderResilienceConfig } from '@zhin.js/ai';
import type { VenueDefinition } from '@zhin.js/core';
import type { AgentBindingConfig } from './types.js';

/** Agent startup policies only. Provider resources and selections belong to the Host runtime graph. */
export interface AgentStartupConfig {
  enabled?: boolean;
  /** ADR 0048 H4: Multi-bot IM rooms (Venues) binding agents to bot endpoints. */
  venues?: readonly VenueDefinition[];
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
    /** 历史消息条数上限（默认 100）；与 historyTokens 取先到者 */
    maxRecentMessages?: number;
    /**
     * 每轮发给模型的历史 token 预算（ADR 0043）。数字对所有场景生效；也可按场景覆盖。
     * 默认群聊 8000、普通私聊 12000、主人私聊 24000；0 = 不按 token 限制。
     */
    historyTokens?: number | string | { group?: number | string; private?: number | string; masterPrivate?: number | string };
    /** 触发总结的消息数量阈值（默认 50） */
    summaryThreshold?: number;
    /** 总结后保留的消息数量（默认 10） */
    keepAfterSummary?: number;
    /** 上下文最大 token 估算（默认 4000） */
    maxContextTokens?: number;
    /** 自定义总结提示词 */
    summaryPrompt?: string;
  };
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
    /** ADR 0048 H3: IM inbox policy of the host Mailbox (renamed from `inboundQueue`). */
    mailbox?: {
      groupMode?: 'supersede' | 'fifo';
      ttlMs?: number;
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
    /**
     * `masterShell: isolated` 时 master 私聊里需审批的调用怎么批。默认 ask：弹确认卡给 master；
     * auto：交给自动审核（审核拒绝时仍会转问 master）；inherit：沿用 `execApprovalMode`。
     */
    masterShellApprovalMode?: 'ask' | 'auto' | 'inherit';
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
    /** @deprecated No effect (#735); `zhin config check --fix` removes it. */
    taskExecApprovalMode?: 'ask' | 'auto' | 'bypass';
    /** 观测主回合阶段日志（或通过 ZHIN_AGENT_PHASE_TRACE=1 开启） */
    phaseTrace?: boolean;
    /** Explicit runtime Service / native-model execution tuning. */
    modelHarness?: ModelHarnessConfig;
    /** Provider 韧性：重试 / 退避 / 超时 / fallback（见 ProviderResilienceConfig，默认保守） */
    providerResilience?: ProviderResilienceConfig;
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
    /** 按会话限制表情回应：两次已发出回应的最小间隔与发出概率（0 = 关闭）；默认 10 分钟 / 0.35 */
    reactions?: {
      cooldownMs?: number;
      probability?: number;
    };
    /** 按用户 / 按群的 token 配额与群速率限制；默认全部关闭，主人默认不受限 */
    usageQuota?: {
      windowMs?: number;
      perUserTokens?: number;
      perGroupTokens?: number;
      perGroupRequestsPerMinute?: number;
      exemptOwner?: boolean;
    };
    /** @deprecated No effect (#735); use `deferredTools.discoverTopK`. */
    deferredToolMaxResults?: number;
    /** 工具 schema 按需加载 */
    deferredTools?: {
      maxLoadedPerSession?: number;
      discoverTopK?: number;
      /** 额外常驻工具；在当前场景档（群聊、私聊、主人私聊）的常驻集合基础上追加 */
      alwaysLoadedTools?: string[];
      /** `extend`（默认）追加到内置常驻集合；`replace` 完全替换 */
      alwaysLoadedMode?: 'extend' | 'replace';
      mcpServers?: Record<string, { alwaysLoaded?: string[] }>;
    };
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
