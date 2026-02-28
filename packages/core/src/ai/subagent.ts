/**
 * SubagentManager — 后台子任务执行管理器
 *
 * 职责：
 *   1. 接收主 agent 发起的 spawn 请求，创建后台子 agent
 *   2. 为子 agent 配备受限工具集（文件/Shell/网络，不含消息/spawn/技能）
 *   3. 管理子 agent 生命周期（运行跟踪、完成/失败回告）
 *   4. 完成后将结果投递回主流程，由主 agent 摘要后发送到原始频道
 */

import { randomUUID } from 'crypto';
import { Logger } from '@zhin.js/logger';
import type { AIProvider, AgentTool } from './types.js';
import { createAgent } from './agent.js';
import type { ZhinAgentConfig } from './zhin-agent/config.js';
import { applyExecPolicyToTools } from './zhin-agent/exec-policy.js';

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
  maxIterations?: number;
  /** Exec policy config to enforce on subagent bash tools */
  execPolicyConfig?: Required<ZhinAgentConfig>;
}

// ============================================================================
// 子 agent 允许使用的工具名单
// ============================================================================

const SUBAGENT_ALLOWED_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
]);

// ============================================================================
// SubagentManager
// ============================================================================

export class SubagentManager {
  private provider: AIProvider;
  private workspace: string;
  private createTools: () => AgentTool[];
  private maxIterations: number;
  private execPolicyConfig: Required<ZhinAgentConfig> | null;
  private runningTasks: Map<string, AbortController> = new Map();
  private resultSender: SubagentResultSender | null = null;

  constructor(options: SubagentManagerOptions) {
    this.provider = options.provider;
    this.workspace = options.workspace;
    this.createTools = options.createTools;
    this.maxIterations = options.maxIterations ?? 15;
    this.execPolicyConfig = options.execPolicyConfig ?? null;
  }

  setSender(sender: SubagentResultSender): void {
    this.resultSender = sender;
  }

  async spawn(options: SpawnOptions): Promise<string> {
    const taskId = randomUUID().slice(0, 8);
    const displayLabel =
      options.label ||
      options.task.slice(0, 30) + (options.task.length > 30 ? '...' : '');

    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);

    this.runSubagent(taskId, options.task, displayLabel, options.origin)
      .catch((error) => {
        logger.error({ error, taskId }, 'Subagent failed');
      })
      .finally(() => {
        this.runningTasks.delete(taskId);
      });

    logger.info({ taskId, label: displayLabel }, 'Spawned subagent');
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
    logger.info({ taskId, label }, 'Subagent starting task');

    try {
      const allTools = this.createTools();
      let tools = allTools.filter(t => SUBAGENT_ALLOWED_TOOLS.has(t.name));
      if (this.execPolicyConfig) {
        tools = applyExecPolicyToTools(this.execPolicyConfig, tools);
      }

      const systemPrompt = this.buildSubagentPrompt(task);
      const agent = createAgent(this.provider, {
        systemPrompt,
        tools,
        maxIterations: this.maxIterations,
      });

      const result = await agent.run(task);
      const finalResult = result.content || '任务已完成，但未生成最终响应。';

      logger.info({ taskId }, 'Subagent completed successfully');
      await this.announceResult(taskId, label, task, finalResult, origin, 'ok');
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
      logger.warn({ taskId }, 'No result sender configured, discarding subagent result');
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
    return `# 子任务 Agent

你是一个被主 agent 派生出来执行特定任务的子 agent。

## 你的任务
${task}

## 规则
1. 专注完成分配的任务，不做其他事情
2. 你的最终回复会被报告给主 agent，并转达给用户
3. 不要发起对话或承担额外任务
4. 回复要简洁但信息充分

## 你可以做的
- 读写工作区内的文件
- 执行 Shell 命令
- 搜索和抓取网页
- 彻底完成任务

## 你不能做的
- 直接向用户发送消息
- 派生其他子任务
- 访问主 agent 的对话历史

## 工作区
你的工作区路径: ${this.workspace}

完成任务后，请提供清晰的发现或操作摘要。`;
  }

  dispose(): void {
    this.runningTasks.clear();
  }
}
