/**
 * SubagentManager — 后台子任务执行管理器
 *
 * 职责：
 *   1. 接收主 agent 发起的 spawn 请求，创建后台子 agent
 *   2. 为子 agent 配备受限工具集（文件/Shell/网络，不含消息/spawn/技能）
 *   3. 管理子 agent 生命周期（运行跟踪、完成/失败回告）
 *   4. 完成后将结果投递回主流程，由主 agent 摘要后发送到原始频道
 */

import { randomUUID } from 'node:crypto';
import { Logger } from '@zhin.js/core';
import { formatCompact, formatCompactUsage, truncatePreview } from '@zhin.js/logger';
import type { AIProvider, AgentTool, Usage } from '@zhin.js/core';
import type { ResolvedAgentBinding } from './config/types.js';
import {
  ensureMcpConnectionsForBinding,
  getMcpToolsForBinding,
} from './orchestrator/mcp-lifecycle.js';
import type { McpRegistry } from './orchestrator/mcp-registry.js';
import { Agent } from '@zhin.js/ai';
import type { AgentResult, ContentPart, ModelRegistry } from '@zhin.js/ai';
import { runAgentLoopStandaloneTurn } from './zhin-agent/agent-loop-standalone.js';
import { DEFAULT_CONFIG, type ZhinAgentConfig } from './zhin-agent/config.js';
import { applyExecPolicyToTools } from './security/exec-policy.js';
import { resolveSubagentAgentTools } from './orchestrator/resolve-subagent-tools.js';
import { createOwnerOrchestratedToolResultTransform } from './orchestrator/owner-confirm-orchestration.js';
import type { ToolContext } from '@zhin.js/core';
import type { FileRole } from './security/file-role-policy.js';
import {
  AgentDispatcher,
  type AgentRole,
  type AgentResult as DispatcherAgentResult,
} from './orchestrator/agent-dispatcher.js';
import { buildSubagentUserDelivery } from './media/subagent-user-delivery.js';
import type { AgentMeta } from './discovery/agents.js';
import { loadAgentMarkdownBody } from './discovery/agents.js';
import {
  resolveSubagentContextMode,
  resolveSubagentRole,
  type SubagentContextMode,
} from './subagent-preset.js';
import { packageSubagentResult } from './subagent-artifact.js';
import { buildSubagentRolePrompt, sanitizeSubagentSystemPrompt } from './subagent-prompt.js';
import type { ToolCallRecord } from './zhin-agent/tool-calls-user-format.js';
import {
  notifySubagentGoal,
  resolveSpawnExecutionKind,
  resolveSubagentAgentLabel,
  resolveSubagentDisplayLabel,
} from './subagent-goal-notify.js';
import { SubagentAiEventReporter } from './subagent-ai-events.js';
import type { ZhinAgentEventEmitter } from './zhin-agent/event-emitter.js';

const logger = new Logger(null, 'Subagent');

// ============================================================================
// 类型
// ============================================================================

export interface SubagentOrigin {
  platform: string;
  botId: string;
  sceneId: string;
  senderId: string;
  sceneType: string;
  /** 入站消息 ID（ICQQ 等 reaction 打字必填） */
  messageId?: string;
  fileRole?: FileRole;
}

export interface SpawnOptions {
  task: string;
  label?: string;
  origin: SubagentOrigin;
  /** 配置/route 中的 agent 名（ai.agents + *.agent.md） */
  agent?: string;
  /** 显式绑定（优先于 agent 名解析） */
  binding?: ResolvedAgentBinding;
  /** 来自 *.agent.md 正文的 system prompt */
  systemPrompt?: string;
  /** Agent 角色（可选，默认为 'subtask'） */
  role?: AgentRole;
  /** fork | fresh；缺省由预设或角色决定 */
  contextMode?: SubagentContextMode;
  /** fork 时由 SubagentManager 注入的主会话快照（内部） */
  contextPreamble?: string;
  /** 任务上下文（可选） */
  context?: Record<string, unknown>;
  /** 首条 user 消息（含 vision parts）；缺省则用 task 字符串 */
  runInput?: string | ContentPart[];
  /** 用于向用户发送「任务【id】:执行通道 => label」进度提示 */
  notifyContext?: ToolContext;
  /** 硬编排任务 ID（AgentDispatcher SSOT） */
  orchestrationTaskId?: string;
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
}

export interface SubagentResultDelivery {
  text: string;
  toolCalls?: AgentResult['toolCalls'] | ToolCallRecord[];
  /** 主 Agent deferred auto-continue turn 的完整出站元素（优先于 text+toolCalls） */
  elements?: import('@zhin.js/ai').OutputElement[];
}

export type SubagentResultSender = (
  origin: SubagentOrigin,
  delivery: SubagentResultDelivery,
) => Promise<void>;

export interface SubagentManagerOptions {
  provider: AIProvider;
  getProvider?: (alias: string) => AIProvider;
  resolveBinding?: (agentName: string) => ResolvedAgentBinding | null;
  getMcpRegistry?: () => McpRegistry | null;
  workspace: string;
  createTools: () => AgentTool[];
  subagentTools?: string[];
  maxIterations?: number;
  /** Exec policy config to enforce on subagent bash tools */
  execPolicyConfig?: Required<ZhinAgentConfig>;
  modelRegistry?: ModelRegistry | null;
  /** 子 agent 完成后回传 token 用量（并入主会话 turn 统计） */
  onSubagentUsage?: (usage: Usage) => void;
  /** 注册子 agent 生命周期 Promise，供主会话在 turn 结束前可选等待 */
  registerSubagentTask?: (done: Promise<void>) => void;
  /** Agent 调度器（可选，用于角色管理） */
  agentDispatcher?: AgentDispatcher;
  /** 生命周期事件回调（供上层桥接到统一事件总线） */
  onEvent?: (event: SubagentLifecycleEvent) => void | Promise<void>;
  /** 与主 ZhinAgent 相同的 AI 处理事件总线（processing / tool / mcp 等） */
  eventEmitter?: ZhinAgentEventEmitter | null;
  /** 解析 *.agent.md 元数据 */
  resolveAgentMeta?: (agentName: string) => Promise<AgentMeta | null>;
  /** fork 模式：主会话 active_leaf 快照 */
  getParentContextSnapshot?: (origin: SubagentOrigin) => Promise<string | undefined>;
}

// ============================================================================
// SubagentManager
// ============================================================================

export class SubagentManager {
  private provider: AIProvider;
  private getProviderFn: ((alias: string) => AIProvider) | null;
  private resolveBindingFn: ((agentName: string) => ResolvedAgentBinding | null) | null;
  private getMcpRegistryFn: (() => McpRegistry | null) | null;
  private workspace: string;
  private createTools: () => AgentTool[];
  private maxIterations: number;
  private subagentTools: string[];
  private execPolicyConfig: Required<ZhinAgentConfig> | null;
  private modelRegistry: ModelRegistry | null;
  private runningTasks: Map<string, AbortController> = new Map();
  private resultSender: SubagentResultSender | null = null;
  private onSubagentUsage: ((usage: Usage) => void) | null;
  private registerSubagentTask: ((done: Promise<void>) => void) | null;
  private agentDispatcher: AgentDispatcher | null;
  private onEvent: ((event: SubagentLifecycleEvent) => void | Promise<void>) | null;
  private eventEmitter: ZhinAgentEventEmitter | null;
  private resolveAgentMetaFn: ((agentName: string) => Promise<AgentMeta | null>) | null;
  private getParentContextSnapshotFn: ((origin: SubagentOrigin) => Promise<string | undefined>) | null;

  constructor(options: SubagentManagerOptions) {
    this.provider = options.provider;
    this.getProviderFn = options.getProvider ?? null;
    this.resolveBindingFn = options.resolveBinding ?? null;
    this.getMcpRegistryFn = options.getMcpRegistry ?? null;
    this.workspace = options.workspace;
    this.createTools = options.createTools;
    this.maxIterations = options.maxIterations ?? 15;
    this.subagentTools = options.subagentTools || [];
    this.execPolicyConfig = options.execPolicyConfig ?? null;
    this.modelRegistry = options.modelRegistry ?? null;
    this.onSubagentUsage = options.onSubagentUsage ?? null;
    this.registerSubagentTask = options.registerSubagentTask ?? null;
    this.agentDispatcher = options.agentDispatcher ?? null;
    this.onEvent = options.onEvent ?? null;
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

  setModelRegistry(registry: ModelRegistry | null): void {
    this.modelRegistry = registry;
  }

  configureRouting(deps: {
    getProvider?: (alias: string) => AIProvider;
    resolveBinding?: (agentName: string) => ResolvedAgentBinding | null;
    getMcpRegistry?: () => McpRegistry | null;
    resolveAgentMeta?: (agentName: string) => Promise<AgentMeta | null>;
    getParentContextSnapshot?: (origin: SubagentOrigin) => Promise<string | undefined>;
  }): void {
    if (deps.getProvider) this.getProviderFn = deps.getProvider;
    if (deps.resolveBinding) this.resolveBindingFn = deps.resolveBinding;
    if (deps.getMcpRegistry) this.getMcpRegistryFn = deps.getMcpRegistry;
    if (deps.resolveAgentMeta) this.resolveAgentMetaFn = deps.resolveAgentMeta;
    if (deps.getParentContextSnapshot) this.getParentContextSnapshotFn = deps.getParentContextSnapshot;
  }

  private async enrichSpawnOptions(options: SpawnOptions): Promise<SpawnOptions> {
    const agentName = options.agent?.trim();
    const meta = agentName && this.resolveAgentMetaFn
      ? await this.resolveAgentMetaFn(agentName)
      : null;
    const role = options.role ?? resolveSubagentRole(meta, agentName);
    const contextMode = resolveSubagentContextMode(meta, role, options.contextMode);
    let systemPrompt = options.systemPrompt;
    if (!systemPrompt && meta?.filePath) {
      try {
        systemPrompt = await loadAgentMarkdownBody(meta.filePath);
      } catch {
        // ignore missing body
      }
    }
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
    };
  }

  /** 同步执行子 agent（入站 route 用）；返回最终文本，不经过 resultSender */
  async spawnSync(options: SpawnOptions): Promise<string> {
    const enriched = await this.enrichSpawnOptions(options);
    const role = enriched.role || 'subtask';
    const displayLabel = resolveSubagentDisplayLabel(enriched.label, enriched.task);
    const taskId = randomUUID().slice(0, 8);
    if (enriched.notifyContext) {
      await notifySubagentGoal(enriched.notifyContext, {
        taskId,
        kind: resolveSpawnExecutionKind({ sync: true, agent: enriched.agent }),
        label: displayLabel,
        agent: enriched.agent,
      });
    }
    const result = await this.runSubagent(
      taskId,
      enriched.task,
      displayLabel,
      enriched.origin,
      role,
      enriched.context,
      {
        binding: enriched.binding ?? (enriched.agent ? this.resolveBindingFn?.(enriched.agent) ?? null : null),
        systemPrompt: enriched.systemPrompt,
        contextPreamble: enriched.contextPreamble,
        sync: true,
        presetName: enriched.agent ?? enriched.label,
        keepTypingUntilUpstreamFinish: true,
        runInput: enriched.runInput,
        orchestrationTaskId: enriched.orchestrationTaskId,
      },
    );
    return result ?? '任务已完成，但未生成最终响应。';
  }

  async spawn(options: SpawnOptions): Promise<string> {
    const enriched = await this.enrichSpawnOptions(options);
    const taskId = randomUUID().slice(0, 8);
    const role = enriched.role || 'subtask';
    const displayLabel = resolveSubagentDisplayLabel(enriched.label, enriched.task);

    if (enriched.notifyContext) {
      await notifySubagentGoal(enriched.notifyContext, {
        taskId,
        kind: resolveSpawnExecutionKind({ sync: false, agent: enriched.agent }),
        label: displayLabel,
        agent: enriched.agent,
      });
    }

    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);

    const binding = enriched.binding ?? (enriched.agent ? this.resolveBindingFn?.(enriched.agent) ?? null : null);
    const done = this.runSubagent(taskId, enriched.task, displayLabel, enriched.origin, role, enriched.context, {
      binding,
      systemPrompt: enriched.systemPrompt,
      contextPreamble: enriched.contextPreamble,
      presetName: enriched.agent ?? enriched.label,
      orchestrationTaskId: enriched.orchestrationTaskId,
    })
      .then(() => undefined)
      .catch((error) => {
        logger.error({ error, taskId }, 'Subagent failed');
      })
      .finally(() => {
        this.runningTasks.delete(taskId);
      });
    this.registerSubagentTask?.(done);

    logger.info(formatCompact({
      subagent: 'spawn',
      task_id: taskId,
      label: displayLabel,
      agent: resolveSubagentAgentLabel(enriched.agent),
      role,
      task: truncatePreview(enriched.task, 300),
    }));
    void this.onEvent?.({
      phase: 'spawn',
      taskId,
      label: displayLabel,
      task: enriched.task,
      origin: enriched.origin,
      role,
      agent: enriched.agent,
    });
    return `子任务 [${displayLabel}] 已启动 (id: ${taskId})，完成后会自动通知你。`;
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private async runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: SubagentOrigin,
    role: AgentRole = 'subtask',
    context?: Record<string, unknown>,
    opts?: {
      binding?: ResolvedAgentBinding | null;
      systemPrompt?: string;
      sync?: boolean;
      presetName?: string;
      /** 为 true 时 processing.finish 不停止 typing（由上层在最终回复前统一 stop） */
      keepTypingUntilUpstreamFinish?: boolean;
      runInput?: string | ContentPart[];
      contextPreamble?: string;
      orchestrationTaskId?: string;
    },
  ): Promise<string | void> {
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
      task_preview: truncatePreview(typeof agentUserInput === 'string' ? agentUserInput : Agent.userMessageToFilterText(agentUserInput), 120),
    }));
    logger.debug(formatCompact( { task_id: taskId, label, role }));

    const aiEvents = this.eventEmitter
      ? new SubagentAiEventReporter(this.eventEmitter, {
        taskId,
        label,
        presetName: opts?.presetName,
        origin,
        keepTypingUntilUpstreamFinish: opts?.keepTypingUntilUpstreamFinish,
      })
      : null;
    if (aiEvents) {
      await aiEvents.processingStart(task);
    }

    await this.onEvent?.({
      phase: 'start',
      taskId,
      label,
      task,
      origin,
      role,
      agent: opts?.presetName,
    });

    let dispatcherTaskId: string | undefined = opts?.orchestrationTaskId;
    const isOrchestrationTask = !!opts?.orchestrationTaskId;
    let resolveOrchestrationRunning: ((r: DispatcherAgentResult) => void) | undefined;
    const binding = opts?.binding ?? null;
    const provider = binding && this.getProviderFn
      ? this.getProviderFn(binding.providerAlias)
      : this.provider;
    try {
      let allTools = this.createTools();
      const mcps = this.getMcpRegistryFn?.() ?? null;
      if (mcps && binding?.mcpServers?.length) {
        if (aiEvents) {
          await aiEvents.ensureMcpForBinding(mcps, binding.mcpServers);
        } else {
          await ensureMcpConnectionsForBinding(mcps, binding.mcpServers);
        }
        allTools = [...allTools, ...getMcpToolsForBinding(mcps, binding.mcpServers)];
      }

      let tools = resolveSubagentAgentTools({
        allTools,
        task,
        role,
        config: (this.execPolicyConfig ?? DEFAULT_CONFIG) as Required<ZhinAgentConfig>,
        agentDispatcher: this.agentDispatcher,
      });

      if (this.execPolicyConfig) {
        tools = applyExecPolicyToTools(this.execPolicyConfig, tools, {
          approvalMode: this.execPolicyConfig.subagentExecApprovalMode,
        });
      }

      let systemPrompt = opts?.systemPrompt;
      if (!systemPrompt) {
        if (this.agentDispatcher && isOrchestrationTask && dispatcherTaskId) {
          const taskDef = this.agentDispatcher.getTask(dispatcherTaskId);
          if (taskDef) {
            systemPrompt = buildSubagentRolePrompt(this.agentDispatcher, taskDef.role, taskDef);
          }
        }
        if (!systemPrompt && this.agentDispatcher) {
          const taskDef = this.agentDispatcher.createTask({
            name: label,
            description: task,
            role,
            goal: task,
            priority: 'medium',
            context,
          });
          if (!isOrchestrationTask) dispatcherTaskId = taskDef.id;
          systemPrompt = buildSubagentRolePrompt(this.agentDispatcher, role, taskDef);
        } else if (!systemPrompt) {
          systemPrompt = this.buildSubagentPrompt(task);
        }
      } else {
        systemPrompt = sanitizeSubagentSystemPrompt(systemPrompt);
      }

      if (isOrchestrationTask && dispatcherTaskId && this.agentDispatcher) {
        const runningPromise = new Promise<DispatcherAgentResult>((resolve) => {
          resolveOrchestrationRunning = resolve;
        });
        this.agentDispatcher.markRunning(dispatcherTaskId, runningPromise);
      }
      if (opts?.contextPreamble?.trim()) {
        systemPrompt = `${systemPrompt}\n\n## Parent session context (fork)\n${opts.contextPreamble.trim()}`;
      }
      const model = binding?.model || provider.models[0];
      const bashToolContext: ToolContext = {
        platform: origin.platform,
        botId: origin.botId,
        sceneId: origin.sceneId,
        senderId: origin.senderId,
        fileRole: origin.fileRole,
      };

      await aiEvents?.agentStart(model);
      const result = await runAgentLoopStandaloneTurn({
        provider,
        resolveProvider: this.getProviderFn ?? undefined,
        model,
        systemPrompt,
        tools,
        userInput: agentUserInput,
        maxIterations: this.maxIterations,
        toolContext: bashToolContext,
        transformToolResult: createOwnerOrchestratedToolResultTransform({
          toolContext: bashToolContext,
          disableHardOrchestration: true,
        }),
        callbacks: aiEvents?.createAgentLoopCallbacks(model),
      });
      this.onSubagentUsage?.(result.usage);
      const rawResult = result.content || '任务已完成，但未生成最终响应。';
      const packaged = packageSubagentResult(rawResult, taskId);
      const finalResult = packaged.text;
      await aiEvents?.agentFinish(result.model ?? model, result.iterations);
      await aiEvents?.response(finalResult, result.model ?? model, result.iterations);

      logger.info(formatCompact({
        subagent: 'done',
        task_id: taskId,
        label,
        agent: resolveSubagentAgentLabel(opts?.presetName),
        total_ms: Date.now() - startedAt,
        usage: formatCompactUsage(result.usage),
        iter: result.iterations,
        model,
        result: truncatePreview(finalResult, 480),
      }));
      await this.onEvent?.({
        phase: 'finish',
        taskId,
        label,
        task,
        origin,
        role,
        agent: opts?.presetName,
        status: 'ok',
        result: finalResult,
      });
      await aiEvents?.processingFinish(finalResult, {
        model: result.model ?? model,
        iterations: result.iterations,
        status: 'ok',
      });
      if (isOrchestrationTask && dispatcherTaskId && this.agentDispatcher) {
        const agentResult: DispatcherAgentResult = {
          taskId: dispatcherTaskId,
          role,
          success: true,
          summary: finalResult.slice(0, 4000),
          duration: Date.now() - startedAt,
          tokenUsage: result.usage
            ? {
                input: result.usage.prompt_tokens ?? 0,
                output: result.usage.completion_tokens ?? 0,
                total: result.usage.total_tokens ?? 0,
              }
            : undefined,
        };
        this.agentDispatcher.recordResult(agentResult);
        resolveOrchestrationRunning?.(agentResult);
      }
      if (opts?.sync) return finalResult;
      await this.announceResult(taskId, label, task, finalResult, origin, 'ok', result.toolCalls);
      return;
    } catch (error) {
      const errorMsg = `Error: ${error instanceof Error ? error.message : String(error)}`;
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
      await this.onEvent?.({
        phase: 'finish',
        taskId,
        label,
        task,
        origin,
        role,
        agent: opts?.presetName,
        status: 'error',
        error: errorMsg,
      });
      if (isOrchestrationTask && dispatcherTaskId && this.agentDispatcher) {
        const failResult: DispatcherAgentResult = {
          taskId: dispatcherTaskId,
          role,
          success: false,
          summary: errorMsg,
          error: errorMsg,
          duration: Date.now() - startedAt,
        };
        this.agentDispatcher.recordResult(failResult);
        resolveOrchestrationRunning?.(failResult);
      }
      if (opts?.sync) return errorMsg;
      await this.announceResult(taskId, label, task, errorMsg, origin, 'error', []);
    } finally {
      if (this.agentDispatcher && dispatcherTaskId && !isOrchestrationTask) {
        this.agentDispatcher.releaseTask(dispatcherTaskId);
      }
    }
    return;
  }

  private async announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    origin: SubagentOrigin,
    status: 'ok' | 'error',
    toolCalls: ToolCallRecord[] = [],
  ): Promise<void> {
    if (!this.resultSender) {
      logger.warn(formatCompact( { task_id: taskId, error: 'no_sender' }));
      return;
    }

    const delivery = buildSubagentUserDelivery({
      label,
      status,
      result,
      toolCalls,
    });

    try {
      await this.resultSender(origin, delivery);
      logger.debug({ taskId, origin, tool_calls: toolCalls.length }, 'Subagent announced result');
    } catch (e) {
      logger.error({ taskId, error: e }, 'Failed to announce subagent result');
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
- Use orchestration tools (spawn_task, tool_search, run_deferred_task)

## Workspace
Workspace path: ${this.workspace}

When done, provide a clear summary of findings or actions.`;
  }

  dispose(): void {
    this.runningTasks.clear();
  }
}
