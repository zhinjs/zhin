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
import { createAgent } from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ZhinAgentConfig } from './zhin-agent/config.js';
import { applyExecPolicyToTools } from './security/exec-policy.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from './reserved-tools.js';
import { resolveContextBudget } from './zhin-agent/context-budget.js';
import { createRestrictedToolView, DEFAULT_SUBAGENT_TOOL_NAMES } from './orchestrator/tool-selection.js';
import { createOwnerOrchestratedToolResultTransform } from './orchestrator/owner-confirm-orchestration.js';
import { runWithDirectAgentExecution } from './security/bash-tool-context.js';
import type { ToolContext } from '@zhin.js/core';

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
}

export interface SpawnOptions {
  task: string;
  label?: string;
  origin: SubagentOrigin;
}

export type SubagentResultSender = (origin: SubagentOrigin, content: string) => Promise<void>;

export interface SubagentManagerOptions {
  provider: AIProvider;
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
}

// ============================================================================
// SubagentManager
// ============================================================================

export class SubagentManager {
  private provider: AIProvider;
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

  constructor(options: SubagentManagerOptions) {
    this.provider = options.provider;
    this.workspace = options.workspace;
    this.createTools = options.createTools;
    this.maxIterations = options.maxIterations ?? 15;
    this.subagentTools = options.subagentTools || [];
    this.execPolicyConfig = options.execPolicyConfig ?? null;
    this.modelRegistry = options.modelRegistry ?? null;
    this.onSubagentUsage = options.onSubagentUsage ?? null;
    this.registerSubagentTask = options.registerSubagentTask ?? null;
  }

  setSender(sender: SubagentResultSender): void {
    this.resultSender = sender;
  }

  setModelRegistry(registry: ModelRegistry | null): void {
    this.modelRegistry = registry;
  }

  async spawn(options: SpawnOptions): Promise<string> {
    const taskId = randomUUID().slice(0, 8);
    const displayLabel =
      options.label ||
      options.task.slice(0, 30) + (options.task.length > 30 ? '...' : '');

    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);

    const done = this.runSubagent(taskId, options.task, displayLabel, options.origin)
      .catch((error) => {
        logger.error({ error, taskId }, 'Subagent failed');
      })
      .finally(() => {
        this.runningTasks.delete(taskId);
      });
    this.registerSubagentTask?.(done);

    logger.debug(formatCompact( { spawn: taskId, label: displayLabel }));
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
  ): Promise<void> {
    const startedAt = Date.now();
    logger.debug(formatCompact( { task_id: taskId, label }));

    try {
      const allTools = this.createTools();
      let tools = createRestrictedToolView(allTools, {
        allowedNames: this.subagentTools.length
          ? this.subagentTools
          : this.execPolicyConfig?.subagentTools?.length
            ? this.execPolicyConfig.subagentTools
          : DEFAULT_SUBAGENT_TOOL_NAMES,
        disabledNames: this.execPolicyConfig?.disabledTools,
      });
      if (this.execPolicyConfig) {
        tools = applyExecPolicyToTools(this.execPolicyConfig, tools);
      }

      const systemPrompt = this.buildSubagentPrompt(task);
      const model = this.provider.models[0];
      const contextBudget = this.execPolicyConfig
        ? resolveContextBudget({
            config: this.execPolicyConfig,
            provider: this.provider,
            modelRegistry: this.modelRegistry,
            model,
          })
        : null;
      const bashToolContext: ToolContext = {
        platform: origin.platform,
        botId: origin.botId,
        sceneId: origin.sceneId,
        senderId: origin.senderId,
      };

      const agent = createAgent(this.provider, {
        model,
        systemPrompt,
        tools,
        maxIterations: this.maxIterations,
        reservedToolNames: RESERVED_TOOL_NAMES,
        reservedToolNamePrefixes: RESERVED_TOOL_NAME_PREFIXES,
        contextWindow: contextBudget?.contextWindow ?? this.provider.contextWindow,
        transformToolResult: createOwnerOrchestratedToolResultTransform({
          toolContext: bashToolContext,
          disableHardOrchestration: true,
        }),
      });

      try {
        const result = await runWithDirectAgentExecution(bashToolContext, () => agent.run(task));
        this.onSubagentUsage?.(result.usage);
        const finalResult = result.content || '任务已完成，但未生成最终响应。';

        logger.debug(formatCompact( {
          task_id: taskId,
          total_ms: Date.now() - startedAt,
          usage: formatCompactUsage(result.usage),
          iter: result.iterations,
          model,
        }));
        await this.announceResult(taskId, label, task, finalResult, origin, 'ok');
      } finally {
        agent.dispose();
      }
    } catch (error) {
      const errorMsg = `Error: ${error}`;
      logger.error({ taskId, error }, 'Subagent failed');
      await this.announceResult(taskId, label, task, errorMsg, origin, 'error');
    }
  }

  private async announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    origin: SubagentOrigin,
    status: 'ok' | 'error',
  ): Promise<void> {
    if (!this.resultSender) {
      logger.warn(formatCompact( { task_id: taskId, error: 'no_sender' }));
      return;
    }

    const statusText = status === 'ok' ? '已完成' : '执行失败';
    const announceContent = `[后台任务 '${label}' ${statusText}]\n\n任务: ${task}\n\n结果:\n${result}`;

    try {
      await this.resultSender(origin, announceContent);
      logger.debug({ taskId, origin }, 'Subagent announced result');
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
- Spawn further sub-tasks
- Access the main agent's conversation history

## Workspace
Workspace path: ${this.workspace}

When done, provide a clear summary of findings or actions.`;
  }

  dispose(): void {
    this.runningTasks.clear();
  }
}
