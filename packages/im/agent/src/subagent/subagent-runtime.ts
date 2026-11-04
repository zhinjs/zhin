import { getAgentTurnConfiguration, runWithAgentTurnConfiguration } from '../turn/agent-turn-context.js';
import { drainAgentTurnDecisionObservations, isAgentTurnDecisionDisabled, runWithAgentDecisionTurn } from '../plugin-runtime/decision-runtime.js';
import type { DecisionObservation } from '../decision/types.js';
import type { MediaPerceptionPort } from '../media/perception.js';
import type { ModelDelegationAuthority, ModelExecutionScope } from '../model-runtime/types.js';
/**
 * SubagentRuntime — 后台子任务执行管理器
 *
 * 职责：
 *   1. 接收主 agent 发起的 spawn 请求，创建后台子 agent
 *   2. 为子 agent 配备受限工具集（文件/Shell/网络，不含消息/spawn/技能）
 *   3. 管理子 agent 生命周期（运行跟踪、完成/失败回告）
 *   4. 完成后将结果投递回主流程，由主 agent 摘要后发送到原始频道
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Message } from '@zhin.js/core';
import { getLogger, formatCompact, formatCompactUsage, truncatePreview } from '@zhin.js/logger';
import { type AgentTool, type Usage } from '@zhin.js/ai';
import type { AgentRunInput, AgentRunInputPart } from '../media/media-types.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import {
  ensureMcpConnectionsForBinding,
  getMcpToolsForBinding,
} from '../resource-hub/mcp-lifecycle.js';
import type { McpRegistry } from '../resource-hub/mcp-registry.js';
import { runAgentLoopStandaloneTurn, type AgentLoopStandaloneResult } from '../core/agent-loop-standalone.js';
import { formatTaskFailure } from '../core/agent-run-shared.js';
import { DEFAULT_CONFIG, type ZhinAgentConfig } from '../config/index.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { resolveSubagentAgentTools } from '../resource-hub/resolve-subagent-tools.js';
import type { AgentRole } from '../resource-hub/role-configs.js';
import { buildSubagentUserDelivery } from '../media/subagent-user-delivery.js';
import { type AgentMeta, type AgentEffortLevel } from '../discovery/agents.js';
const EFFORT_MAX_ITERATIONS: Record<AgentEffortLevel, number> = {
  low: 3,
  medium: 5,
  high: 10,
  max: 20,
};
import {
  resolveSubagentContextMode,
  resolveSubagentRole,
  type SubagentContextMode,
} from '../subagent-preset.js';
import { packageSubagentResult } from '../subagent-artifact.js';
import { sanitizeSubagentSystemPrompt } from '../subagent-prompt.js';
import type { ToolCallRecord } from '../core/tool-calls-user-format.js';
import {
  notifySubagentGoal,
  resolveSpawnExecutionKind,
  resolveSubagentAgentLabel,
  resolveSubagentDisplayLabel,
} from '../subagent-goal-notify.js';
import { SubagentAiEventReporter } from '../subagent-ai-events.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';

const logger = getLogger('Subagent');

/** runInput 部件数组的文本预览（仅拼接 text 部件）。 */
function runInputPreviewText(parts: AgentRunInputPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && Boolean(p.text?.trim()))
    .map((p) => p.text)
    .join('\n');
}

// ============================================================================
// 类型
// ============================================================================

export interface SubagentOrigin {
  message: Message;
}

export interface SpawnOptions {
  task: string;
  label?: string;
  origin: SubagentOrigin;
  /** 配置/route 中的 agent 名（ai.agents + agents/<name>/agent.json） */
  agent?: string;
  /** 显式绑定（优先于 agent 名解析） */
  binding?: ResolvedAgentBinding;
  /** 来自目录化 Agent entry_points 的 system prompt */
  systemPrompt?: string;
  /** Agent 角色（可选，默认为 'subtask'） */
  role?: AgentRole;
  /** fork | fresh；缺省由预设或角色决定 */
  contextMode?: SubagentContextMode;
  /** fork 时由 SubagentRuntime 注入的主会话快照（内部） */
  contextPreamble?: string;
  /** 任务上下文（可选） */
  context?: Record<string, unknown>;
  /** 首条 user 消息（含 vision 媒体块）；缺省则用 task 字符串 */
  runInput?: AgentRunInput;
  /** 用于向用户发送「任务【id】:执行通道 => label」进度提示 */
  notifyContext?: Message;
  /** spawn_task 声明的子任务工具（与父会话 sessionLoaded 取交集作为初始池） */
  requestedTools?: string[];
  /** spawn_task 声明的技能名 */
  requestedSkills?: string[];
  /** 父会话已 load 的工具名 */
  parentSessionLoaded?: string[];
  /** 父会话已 load 的技能名 */
  parentLoadedSkills?: string[];
}

export interface SubagentLifecycleEvent {
  phase: 'spawn' | 'start' | 'finish';
  taskId: string;
  label: string;
  task: string;
  origin: SubagentOrigin;
  role?: AgentRole;
  /** ai.agents 名，如 pm / architect / dev */
  agent?: string;
  status?: 'ok' | 'error';
  result?: string;
  error?: string;
  /** Decisions observed by this child operation, never its completed parent. */
  decisionObservations?: readonly DecisionObservation[];
}

/** Async subagent completion payload — delivered to main agent first. */
export interface SubagentCompletePayload {
  taskId: string;
  label: string;
  task: string;
  origin: SubagentOrigin;
  status: 'ok' | 'error';
  result: string;
  toolCalls: ToolCallRecord[];
  terminal?: AgentLoopStandaloneResult['terminal'];
  agent?: string;
}

/** Same task outcome as async delivery, without its routing metadata. */
export type SubagentSyncResult = Pick<SubagentCompletePayload, 'status' | 'result' | 'toolCalls' | 'terminal'>;

export interface SubagentResultDelivery {
  text: string;
  toolCalls?: { tool: string; args: Record<string, any>; result: any }[] | ToolCallRecord[];
  /** 主 Agent deferred auto-continue turn 的完整出站元素（优先于 text+toolCalls） */
  elements?: import('../outbound/agent-output.js').AgentOutputElement[];
  /** 子任务 ID（非 IM ResultSink 投递时使用） */
  taskId?: string;
  /** 子任务状态（非 IM ResultSink 投递时使用） */
  status?: 'ok' | 'error';
}

export type SubagentResultSender = (
  origin: SubagentOrigin,
  delivery: SubagentResultDelivery,
) => Promise<void>;

export interface SubagentRuntimeOptions {
  resolveBinding?: (agentName: string) => ResolvedAgentBinding | null;
  getMcpRegistry?: () => McpRegistry | null;
  workspace: string;
  createTools: () => AgentTool[];
  subagentTools?: string[];
  maxIterations?: number;
  /** 并行子 agent 硬上限（ADR 0030） */
  maxParallelSubagents?: number;
  /** Exec policy config to enforce on subagent bash tools */
  execPolicyConfig?: Required<ZhinAgentConfig>;
  /** 子 agent 完成后回传 token 用量（并入主会话 turn 统计） */
  onSubagentUsage?: (usage: Usage) => void;
  /** 注册子 agent 生命周期 Promise，供主会话在 turn 结束前可选等待 */
  registerSubagentTask?: (done: Promise<void>) => void;
  /** 生命周期事件回调（供上层桥接到统一事件总线） */
  onEvent?: (event: SubagentLifecycleEvent) => void | Promise<void>;
  /** 异步子 agent 完成：结果交还主 agent（优先于 resultSender） */
  onSubagentComplete?: (payload: SubagentCompletePayload) => Promise<void>;
  /** 与主 ZhinAgent 相同的 AI 处理事件总线（processing / tool / mcp 等） */
  eventEmitter?: ZhinAgentEventEmitter | null;
  /** 解析 agents/<name>/agent.json 元数据 */
  resolveAgentMeta?: (agentName: string) => Promise<AgentMeta | null>;
  /** fork 模式：主会话 active_leaf 快照 */
  getParentContextSnapshot?: (origin: SubagentOrigin) => Promise<string | undefined>;
}

// ============================================================================
// SubagentRuntime
// ============================================================================

/** One generation-owned subtask; presentation metadata cannot choose model ownership. */
interface SubagentTaskRun {
 readonly taskId:string;
 readonly task:string;
 readonly label:string;
 readonly origin:SubagentOrigin;
 readonly role?:AgentRole;
 readonly context?:Record<string,unknown>;
 readonly options?:{
      delegation: ModelDelegationAuthority;
      decisionDisabled: boolean;
      binding?: ResolvedAgentBinding | null;
      systemPrompt?: string;
      sync?: boolean;
      presetName?: string;
      modelRole?: string;
      /** 为 true 时 processing.finish 不停止 typing（由上层在最终回复前统一 stop） */
      keepTypingUntilUpstreamFinish?: boolean;
      runInput?: AgentRunInput;
      contextPreamble?: string;
      agentMeta?: AgentMeta;
      requestedTools?: string[];
      requestedSkills?: string[];
      parentSessionLoaded?: string[];
      parentLoadedSkills?: string[];
      signal?: AbortSignal;
    };
}

export class SubagentRuntime {
  private imageAssets?: import('../media/image-assets.js').ImageAssetPublisher;
  private localAssets?: import('../media/local-image-assets.js').LocalImageAssetStore;
  private createPerception?: (models: ModelExecutionScope) => MediaPerceptionPort | undefined;
  private resolveBindingFn: ((agentName: string) => ResolvedAgentBinding | null) | null;
  private getMcpRegistryFn: (() => McpRegistry | null) | null;
  private workspace: string;
  private createTools: () => AgentTool[];
  private maxIterations: number;
  private maxParallelSubagents: number;
  private subagentTools: string[];
  private execPolicyConfig: Required<ZhinAgentConfig> | null;
  private runningTasks: Map<string, AbortController> = new Map();
  private resultSender: SubagentResultSender | null = null;
  private onSubagentUsage: ((usage: Usage) => void) | null;
  private registerSubagentTask: ((done: Promise<void>) => void) | null;
  private onEvent: ((event: SubagentLifecycleEvent) => void | Promise<void>) | null;
  private onSubagentCompleteFn: ((payload: SubagentCompletePayload) => Promise<void>) | null;
  private eventEmitter: ZhinAgentEventEmitter | null;
  private resolveAgentMetaFn: ((agentName: string) => Promise<AgentMeta | null>) | null;
  private getParentContextSnapshotFn: ((origin: SubagentOrigin) => Promise<string | undefined>) | null;
  private disposed = false;
  private disposalStarted = false;
  private externalDisposal?: Promise<void>;
  private internalDisposalOwner?: string;
  private readonly taskContext = new AsyncLocalStorage<string>();
  private readonly taskSettlements = new Map<string, Promise<void>>();

  constructor(options: SubagentRuntimeOptions) {
    this.resolveBindingFn = options.resolveBinding ?? null;
    this.getMcpRegistryFn = options.getMcpRegistry ?? null;
    this.workspace = options.workspace;
    this.createTools = options.createTools;
    this.maxIterations = options.maxIterations ?? 15;
    this.maxParallelSubagents = options.maxParallelSubagents ?? 5;
    this.subagentTools = options.subagentTools || [];
    this.execPolicyConfig = options.execPolicyConfig ?? null;
    this.onSubagentUsage = options.onSubagentUsage ?? null;
    this.registerSubagentTask = options.registerSubagentTask ?? null;
    this.onEvent = options.onEvent ?? null;
    this.onSubagentCompleteFn = options.onSubagentComplete ?? null;
    this.eventEmitter = options.eventEmitter ?? null;
    this.resolveAgentMetaFn = options.resolveAgentMeta ?? null;
    this.getParentContextSnapshotFn = options.getParentContextSnapshot ?? null;
  }

  setEventEmitter(emitter: ZhinAgentEventEmitter | null): void {
    this.eventEmitter = emitter;
  }

  setSender(sender: SubagentResultSender): void {
    this.resultSender = sender;
  }


  configureRouting(deps: {
    imageAssets?: import('../media/image-assets.js').ImageAssetPublisher;
    localAssets?: import('../media/local-image-assets.js').LocalImageAssetStore;
    /** Build a task-local port from the child's acquired model scope. */
    createPerception?: (models: ModelExecutionScope) => MediaPerceptionPort | undefined;
    resolveBinding?: (agentName: string) => ResolvedAgentBinding | null;
    getMcpRegistry?: () => McpRegistry | null;
    resolveAgentMeta?: (agentName: string) => Promise<AgentMeta | null>;
    getParentContextSnapshot?: (origin: SubagentOrigin) => Promise<string | undefined>;
  }): void {
    if (deps.imageAssets !== undefined) this.imageAssets = deps.imageAssets;
    if (deps.localAssets !== undefined) this.localAssets = deps.localAssets;
    if (deps.createPerception !== undefined) this.createPerception = deps.createPerception;
    if (deps.resolveBinding) this.resolveBindingFn = deps.resolveBinding;
    if (deps.getMcpRegistry) this.getMcpRegistryFn = deps.getMcpRegistry;
    if (deps.resolveAgentMeta) this.resolveAgentMetaFn = deps.resolveAgentMeta;
    if (deps.getParentContextSnapshot) this.getParentContextSnapshotFn = deps.getParentContextSnapshot;
  }

  private async enrichSpawnOptions(options: SpawnOptions): Promise<SpawnOptions & { _agentMeta?: AgentMeta }> {
    const agentName = options.agent?.trim();
    const meta = agentName && this.resolveAgentMetaFn
      ? await this.resolveAgentMetaFn(agentName)
      : null;
    const role = options.role ?? resolveSubagentRole(meta, agentName);
    const contextMode = resolveSubagentContextMode(meta, role, options.contextMode);
    let systemPrompt = options.systemPrompt;
    if (!systemPrompt && meta?.systemPrompt) systemPrompt = meta.systemPrompt;
    let contextPreamble = options.contextPreamble;
    if (contextMode === 'fork' && !contextPreamble && this.getParentContextSnapshotFn) {
      contextPreamble = await this.getParentContextSnapshotFn(options.origin);
    }
    return {
      ...options,
      role,
      contextMode,
      systemPrompt,
      contextPreamble,
      _agentMeta: meta ?? undefined,
    };
  }

  /** Execute once and return its outcome; synchronous runs do not use resultSender. */
  spawnSync(options: SpawnOptions): Promise<SubagentSyncResult> {
    const delegation = getAgentTurnConfiguration()?.models?.retainDelegation();
    if (!delegation) return Promise.reject(new Error('Subagent inference scope is not configured'));
    return this.spawnSyncInner(options, delegation, isAgentTurnDecisionDisabled()).finally(() => delegation.release());
  }

  private async spawnSyncInner(options: SpawnOptions, delegation: ModelDelegationAuthority, decisionDisabled: boolean): Promise<SubagentSyncResult> {
    if (this.disposed) throw new Error('SubagentRuntime has been disposed');
    const capError = this.parallelCapacityError();
    if (capError) return { status: 'error', result: capError, toolCalls: [] };

    const enriched = await this.enrichSpawnOptions(options);
    this.assertActive();
    const role = enriched.role || 'subtask';
    const displayLabel = resolveSubagentDisplayLabel(enriched.label, enriched.task);
    const taskId = randomUUID().slice(0, 8);
    this.trackRunningTask(taskId);
    const signal = this.runningTasks.get(taskId)!.signal;
    try {
      if (enriched.notifyContext) {
        await notifySubagentGoal(enriched.notifyContext, {
          taskId,
          kind: resolveSpawnExecutionKind({ sync: true }),
          label: displayLabel,
          agent: enriched.agent,
        });
        this.assertActive(signal);
      }
      const running = this.runAdmittedTask(taskId, () => this.runSubagent({ taskId: taskId, task: enriched.task, label: displayLabel, origin: enriched.origin, role: role, context: enriched.context, options: {
          delegation,
          decisionDisabled,
          binding: enriched.binding ?? (enriched.agent ? this.resolveBindingFn?.(enriched.agent) ?? null : null),
          systemPrompt: enriched.systemPrompt,
          contextPreamble: enriched.contextPreamble,
          sync: true,
          presetName: enriched.agent ?? enriched.label,
          modelRole: enriched.agent,
          keepTypingUntilUpstreamFinish: true,
          runInput: enriched.runInput,
          agentMeta: enriched._agentMeta,
          requestedTools: enriched.requestedTools,
          requestedSkills: enriched.requestedSkills,
          parentSessionLoaded: enriched.parentSessionLoaded,
          parentLoadedSkills: enriched.parentLoadedSkills,
          signal,
        } }));
      const result = await running;
      return { status: result.status, result: result.result, toolCalls: result.toolCalls,
        ...(result.terminal ? { terminal: result.terminal } : {}) };
    } finally {
      this.releaseRunningTask(taskId);
    }
  }

  spawn(options: SpawnOptions): Promise<string> {
    const delegation = getAgentTurnConfiguration()?.models?.retainDelegation();
    if (!delegation) return Promise.reject(new Error('Subagent inference scope is not configured'));
    return this.spawnInner(options, delegation, isAgentTurnDecisionDisabled());
  }

  private async spawnInner(options: SpawnOptions, delegation: ModelDelegationAuthority, decisionDisabled: boolean): Promise<string> {
    let admitted: Promise<void> | undefined;
    try {
    if (this.disposed) throw new Error('SubagentRuntime has been disposed');
    const capError = this.parallelCapacityError();
    if (capError) return capError;

    const enriched = await this.enrichSpawnOptions(options);
    this.assertActive();
    const taskId = randomUUID().slice(0, 8);
    const role = enriched.role || 'subtask';
    const displayLabel = resolveSubagentDisplayLabel(enriched.label, enriched.task);

    if (enriched.notifyContext) {
      await notifySubagentGoal(enriched.notifyContext, {
        taskId,
        kind: resolveSpawnExecutionKind({ sync: false }),
        label: displayLabel,
        agent: enriched.agent,
      });
      this.assertActive();
    }

    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);

    logger.info(formatCompact({
      subagent: 'spawn',
      task_id: taskId,
      label: displayLabel,
      agent: resolveSubagentAgentLabel(enriched.agent),
      role,
      task: truncatePreview(enriched.task, 300),
    }));
    await this.publishLifecycleEvent({
      phase: 'spawn',
      taskId,
      label: displayLabel,
      task: enriched.task,
      origin: enriched.origin,
      role,
      agent: enriched.agent,
    });
    try {
      this.assertActive(abortController.signal);
    } catch (error) {
      this.runningTasks.delete(taskId);
      throw error;
    }

    const binding = enriched.binding ?? (enriched.agent ? this.resolveBindingFn?.(enriched.agent) ?? null : null);
    const done = this.runAdmittedTask(taskId, async () => {
      try {
        await this.runSubagent({ taskId: taskId, task: enriched.task, label: displayLabel, origin: enriched.origin, role: role, context: enriched.context, options: {
          delegation,
          decisionDisabled,
          binding,
          systemPrompt: enriched.systemPrompt,
          contextPreamble: enriched.contextPreamble,
          presetName: enriched.agent ?? enriched.label,
          modelRole: enriched.agent,
          agentMeta: enriched._agentMeta,
          requestedTools: enriched.requestedTools,
          requestedSkills: enriched.requestedSkills,
          parentSessionLoaded: enriched.parentSessionLoaded,
          parentLoadedSkills: enriched.parentLoadedSkills,
          signal: abortController.signal,
        } });
      } catch (error) {
        logger.error({ error, taskId }, 'Subagent failed');
      }
    }, () => this.runningTasks.delete(taskId)).finally(() => delegation.release());
    admitted = done;
    this.registerSubagentTask?.(done);

    return `子任务 [${displayLabel}] 已启动 (id: ${taskId})，完成后会自动通知你。`;
    } finally { if (!admitted) await delegation.release(); }
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  cancel(taskId: string): boolean {
    const controller = this.runningTasks.get(taskId);
    if (!controller) return false;
    try {
      controller.abort();
    } catch {
      // ignore
    }
    return true;
  }

  private parallelCapacityError(): string | undefined {
    const running = this.getRunningCount();
    if (running >= this.maxParallelSubagents) {
      return (
        `并行子代理已达上限 (${running}/${this.maxParallelSubagents})。`
        + '请等待已有任务完成，或拆分批次后再 spawn。'
      );
    }
    return undefined;
  }

  private trackRunningTask(taskId: string): void {
    this.runningTasks.set(taskId, new AbortController());
  }

  private releaseRunningTask(taskId: string): void {
    this.runningTasks.delete(taskId);
  }

  private async publishLifecycleEvent(event: SubagentLifecycleEvent): Promise<void> {
    try {
      await this.onEvent?.(event);
    } catch (error) {
      logger.error({ taskId: event.taskId, phase: event.phase, error }, 'Subagent lifecycle observer failed');
    }
  }

  private assertActive(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (this.disposed) {
      throw new DOMException('SubagentRuntime generation retired', 'AbortError');
    }
  }

  private runAdmittedTask<T>(
    taskId: string,
    operation: () => Promise<T>,
    finalize: () => void = () => undefined,
  ): Promise<T> {
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => { settle = resolve; });
    this.taskSettlements.set(taskId, settlement);
    let running: Promise<T>;
    try {
      running = this.taskContext.run(taskId, operation);
    } catch (error) {
      finalize();
      this.taskSettlements.delete(taskId);
      settle();
      throw error;
    }
    return running.finally(() => {
      finalize();
      if (this.taskSettlements.get(taskId) === settlement) this.taskSettlements.delete(taskId);
      settle();
    });
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private async runSubagent(input: SubagentTaskRun): Promise<SubagentSyncResult> {
    const { taskId, task, label, origin, role = 'subtask', context, options: opts } = input;
    const startedAt = Date.now();
    const agentUserInput = opts?.runInput ?? task;
    const inputKind = typeof agentUserInput === 'string' ? 'text' : `parts:${agentUserInput.length}`;
    logger.info(formatCompact({
      subagent: 'start',
      task_id: taskId,
      label,
      agent: resolveSubagentAgentLabel(opts?.presetName),
      role,
      input: inputKind,
      task_preview: truncatePreview(typeof agentUserInput === 'string' ? agentUserInput : runInputPreviewText(agentUserInput), 120),
    }));
    logger.debug(formatCompact( { task_id: taskId, label, role }));

    const aiEvents = this.eventEmitter
      ? new SubagentAiEventReporter(this.eventEmitter, {
        taskId,
        label,
        presetName: opts?.presetName,
        role,
        origin,
        keepTypingUntilUpstreamFinish: opts?.keepTypingUntilUpstreamFinish,
      })
      : null;
    if (aiEvents) {
      await aiEvents.processingStart(task);
    }

    await this.publishLifecycleEvent({
      phase: 'start',
      taskId,
      label,
      task,
      origin,
      role,
      agent: opts?.presetName,
    });

    const binding = opts?.binding ?? null;
    let models: ModelExecutionScope | undefined;
    let observedResult: AgentLoopStandaloneResult | undefined;
    let usageReported = false;
    const reportUsage = (): void => {
      if (!observedResult || usageReported) return;
      usageReported = true;
      const failed = (): void => { logger.warn('Subagent usage observer failed'); };
      try { void Promise.resolve(this.onSubagentUsage?.(observedResult.usage)).catch(failed); }
      catch { failed(); }
    };
    const decisionObservations: DecisionObservation[] = [];
    try {
      let allTools = this.createTools();
      const mcps = this.getMcpRegistryFn?.() ?? null;
      if (mcps && binding?.mcpServers?.length) {
        if (aiEvents) {
          await aiEvents.ensureMcpForBinding(mcps, [...binding.mcpServers]);
        } else {
          await ensureMcpConnectionsForBinding(mcps, [...binding.mcpServers]);
        }
        allTools = [...allTools, ...getMcpToolsForBinding(mcps, [...binding.mcpServers])];
      }

      let tools = resolveSubagentAgentTools({
        allTools,
        task,
        role,
        config: (this.execPolicyConfig ?? DEFAULT_CONFIG) as Required<ZhinAgentConfig>,
        agentMeta: opts?.agentMeta,
        requestedTools: opts?.requestedTools,
        parentSessionLoaded: opts?.parentSessionLoaded,
      });

      if (this.execPolicyConfig) {
        tools = applyExecPolicyToTools(this.execPolicyConfig, tools, {
          approvalMode: this.execPolicyConfig.subagentExecApprovalMode,
        });
      }

      let systemPrompt = opts?.systemPrompt;
      if (!systemPrompt) {
        systemPrompt = this.buildSubagentPrompt(task);
      } else {
        systemPrompt = sanitizeSubagentSystemPrompt(systemPrompt);
      }
      if (opts?.contextPreamble?.trim()) {
        systemPrompt = `${systemPrompt}\n\n## Parent session context (fork)\n${opts.contextPreamble.trim()}`;
      }
      if (!opts?.delegation) throw new Error('Subagent inference scope is not configured');
      models = await opts.delegation.acquire({ operationId: `subagent:${taskId}`, sessionKey: `subagent:${taskId}`,
        epoch: taskId, bindingName: binding?.name ?? opts?.modelRole ?? 'zhin', signal: opts?.signal });
      const childModels = models;
      const mediaPerception = this.createPerception?.(childModels);
      const model = childModels.chat.model.id;
      const bashCommMessage = origin.message;

      await aiEvents?.agentStart(model);
      const effortIterations = opts?.agentMeta?.effort
        ? EFFORT_MAX_ITERATIONS[opts.agentMeta.effort]
        : undefined;
      // Tool-side inference must borrow the child's scope too. Async tasks can
      // inherit a parent ALS store whose client has already been released.
      const result = await runWithAgentDecisionTurn({
        turnId: childModels.context.operationId,
        models: childModels,
        inferenceSnapshot: childModels.inferenceSnapshot,
        disabled: opts.decisionDisabled,
      }, async () => {
        try {
          return await runWithAgentTurnConfiguration({ models: childModels, activeBinding: binding ?? undefined, mediaPerception },
            () => runAgentLoopStandaloneTurn({
              execution: childModels.chat,
              imageAssets: this.imageAssets,
              localAssets: this.localAssets,
              mediaPerception,
              systemPrompt,
              tools,
              userInput: agentUserInput,
              maxIterations: effortIterations ?? opts.agentMeta?.maxIterations ?? this.maxIterations,
              commMessage: bashCommMessage,
              callbacks: { ...aiEvents?.createAgentLoopCallbacks(model),
                onInterrupted: snapshot => { observedResult = snapshot; } },
              signal: opts.signal,
            }));
        } finally {
          decisionObservations.push(...drainAgentTurnDecisionObservations());
        }
      });
      observedResult = result;
      reportUsage();
      const status = result.terminal?.stopReason === 'error' || result.terminal?.stopReason === 'aborted' ? 'error' : 'ok';
      const rawResult = result.content || (status === 'error'
        ? result.terminal?.errorMessage || '子任务未能完成，模型未返回最终响应。'
        : '任务已完成，但未生成最终响应。');
      const packaged = packageSubagentResult(status === 'error'
        ? formatTaskFailure({ content: rawResult, errorMessage: result.terminal?.errorMessage }) : rawResult, taskId);
      const finalResult = packaged.text;
      if (status === 'ok') {
        await aiEvents?.agentFinish(result.model ?? model, result.iterations);
        await aiEvents?.response(finalResult, result.model ?? model, result.iterations);
      } else {
        await aiEvents?.processingError(result.terminal?.errorMessage ?? finalResult);
      }

      logger.info(formatCompact({
        subagent: 'done',
        ok: status === 'error' ? false : undefined,
        task_id: taskId,
        label,
        agent: resolveSubagentAgentLabel(opts?.presetName),
        total_ms: Date.now() - startedAt,
        usage: formatCompactUsage(result.usage),
        iter: result.iterations,
        model,
        result: truncatePreview(finalResult, 480),
      }));
      await this.publishLifecycleEvent({
        phase: 'finish',
        taskId,
        label,
        task,
        origin,
        role,
        agent: opts?.presetName,
        status,
        result: finalResult,
        ...(status === 'error' ? { error: result.terminal?.errorMessage ?? finalResult } : {}),
        ...(decisionObservations.length ? { decisionObservations } : {}),
      });
      if (status === 'ok') {
        await aiEvents?.processingFinish(finalResult, {
          model: result.model ?? model,
          iterations: result.iterations,
          status,
        });
      }
      const outcome: SubagentCompletePayload = {
        taskId,
        label,
        task,
        origin,
        status,
        result: finalResult,
        toolCalls: result.toolCalls,
        ...(result.terminal ? { terminal: result.terminal } : {}),
        agent: opts?.presetName,
      };
      if (!opts?.sync) await this.deliverAsyncResult(outcome);
      return outcome;
    } catch (error) {
      reportUsage();
      const reason = error instanceof Error ? error.message : String(error);
      const errorMsg = `Error: ${reason}`;
      const partialContent = observedResult?.content;
      const resultText = formatTaskFailure({ content: partialContent ?? '', errorMessage: reason }) || errorMsg;
      await aiEvents?.processingError(errorMsg);
      logger.error({ taskId, error }, 'Subagent failed');
      logger.info(formatCompact({
        subagent: 'done',
        task_id: taskId,
        label,
        agent: resolveSubagentAgentLabel(opts?.presetName),
        ok: false,
        error: truncatePreview(errorMsg, 300),
      }));
      await this.publishLifecycleEvent({
        phase: 'finish',
        taskId,
        label,
        task,
        origin,
        role,
        agent: opts?.presetName,
        status: 'error',
        error: errorMsg,
        ...(partialContent ? { result: resultText } : {}),
        ...(decisionObservations.length ? { decisionObservations } : {}),
      });
      const outcome: SubagentCompletePayload = {
        taskId,
        label,
        task,
        origin,
        status: 'error',
        result: resultText,
        toolCalls: observedResult?.toolCalls ?? [],
        ...(observedResult?.terminal ? { terminal: observedResult.terminal } : {}),
        agent: opts?.presetName,
      };
      if (!opts?.sync) await this.deliverAsyncResult(outcome);
      return outcome;
    } finally {
      try { await models?.release(); }
      catch { logger.warn('Subagent inference cleanup failed'); }
    }
  }

  private async deliverAsyncResult(payload: SubagentCompletePayload): Promise<void> {
    // Generation retirement aborts work to release resources. Its cancellation
    // terminal is still emitted above for activity cleanup, but an old runtime
    // must never enqueue a new main-agent continuation or direct IM delivery.
    if (this.disposed) return;
    if (this.onSubagentCompleteFn) {
      // 勿 await：onSubagentComplete → auto-continue 会 waitForIdle()，而主回合仍在
      // waitForPendingSubagents 中等待本 subagent 的 done，同步 await 会死锁。
      void this.onSubagentCompleteFn(payload).catch((error) => {
        logger.error({ taskId: payload.taskId, error }, 'onSubagentComplete failed');
      });
    } else {
      logger.warn(formatCompact({ task_id: payload.taskId, error: 'no_onSubagentComplete' }));
    }

    if (!this.resultSender) return;

    const delivery = {
      ...buildSubagentUserDelivery({
        label: payload.label,
        status: payload.status,
        result: payload.result,
        toolCalls: payload.toolCalls,
      }),
      taskId: payload.taskId,
      status: payload.status,
    };

    try {
      await this.resultSender(payload.origin, delivery);
      logger.debug({
        taskId: payload.taskId,
        origin: payload.origin,
        tool_calls: payload.toolCalls.length,
      }, 'Subagent direct IM delivery');
    } catch (error) {
      logger.error({ taskId: payload.taskId, error }, 'Subagent direct IM delivery failed');
    }
  }

  private buildSubagentPrompt(task: string): string {
    return `# Sub-task Agent

You are a sub-agent spawned by the main agent to perform a specific task.

## Your task
${task}

## Rules
1. Focus only on the assigned task
2. Your final reply will be reported to the main agent and relayed to the user
3. Do not start new conversations or take on extra tasks
4. Keep replies concise but informative
5. Never claim success unless tool results confirm it
6. Do not fabricate tool outputs or execution status

## You may
- Read/write files in the workspace
- Run shell commands (no Owner online approval in this sub-agent; deny/dangerous rules still apply)
- Search and fetch the web
- Complete the task thoroughly

## You must not
- Send messages directly to the user
- Spawn further sub-tasks or delegate to other agents
- Use orchestration tools (spawn_task, discover)

## Workspace
Workspace path: ${this.workspace}

When done, provide a clear summary of findings or actions.`;
  }

  dispose(): Promise<void> {
    if (!this.disposalStarted) {
      this.disposalStarted = true;
      this.disposed = true;
      for (const controller of this.runningTasks.values()) {
        try { controller.abort(); } catch { /* ignore */ }
      }
    }

    const currentTaskId = this.taskContext.getStore();
    if (currentTaskId) {
      // The first in-task disposer may wait for peers, but never itself. Any
      // peer that also disposes must return immediately so two terminal
      // observers cannot cross-wait each other.
      if (this.internalDisposalOwner) return Promise.resolve();
      this.internalDisposalOwner = currentTaskId;
      return this.awaitTaskSettlements(currentTaskId);
    }

    if (!this.externalDisposal) {
      this.externalDisposal = this.awaitTaskSettlements();
    }
    return this.externalDisposal;
  }

  private async awaitTaskSettlements(excludedTaskId?: string): Promise<void> {
    while (true) {
      const pending = [...this.taskSettlements.entries()]
        .filter(([taskId]) => taskId !== excludedTaskId)
        .map(([, settlement]) => settlement);
      if (pending.length === 0) break;
      await Promise.allSettled(pending);
    }
    if (!excludedTaskId) {
      this.runningTasks.clear();
    }
  }
}
