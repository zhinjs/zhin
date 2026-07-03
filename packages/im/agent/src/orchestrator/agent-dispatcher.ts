/**
 * Agent 调度器
 *
 * - 明确的角色定义和权限继承
 * - 工具权限的精细化控制
 * - 上下文隔离和结果聚合
 * - 统一的错误处理和监控
 */

import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@zhin.js/ai';
import type { OrchestrationExecutorKind, OrchestrationTaskRecord, OrchestrationTaskStatus } from '@zhin.js/ai';
import { taskRecordToAgentTaskShape, type OrchestrationRepository } from './orchestration-repository.js';

// ── Agent 角色定义 ────────────────────────────────────────────────────

export type AgentRole =
  | 'subtask'        // 子任务 Agent（后台执行）
  | 'worker'         // 工作 Agent（延迟任务）
  | 'researcher'     // 研究 Agent（只读检索）
  | 'evaluator'      // 评估 Agent（纯推理，零外部工具，ADR 0024）
  | 'executor'       // 执行 Agent（写操作）
  | 'reviewer'       // 审查 Agent（质检；仅读 artifact）
  | 'planner';       // 规划 Agent（总控/路由，ADR 0024 director）

export interface AgentRoleConfig {
  /** 角色名称 */
  role: AgentRole;
  /** 角色描述 */
  description: string;
  /** 允许的工具集 */
  allowedTools: string[];
  /** 禁止的工具集 */
  blockedTools: string[];
  /** 是否允许发送消息给用户 */
  canSendMessage: boolean;
  /** 是否允许 spawn 子 Agent */
  canSpawnSubagents: boolean;
  /** 是否允许访问主 Agent 历史 */
  canAccessMainHistory: boolean;
  /** 是否允许执行写操作 */
  canWrite: boolean;
  /** 是否允许执行危险操作 */
  canExecuteDangerous: boolean;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 最大工具调用次数 */
  maxToolCalls: number;
  /** 超时时间（毫秒） */
  timeout: number;
}

// ── 预定义角色配置 ────────────────────────────────────────────────────

export const AGENT_ROLE_CONFIGS: Record<AgentRole, AgentRoleConfig> = {
  subtask: {
    role: 'subtask',
    description: '子任务 Agent，后台执行特定任务',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent', 'discover'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 15,
    maxToolCalls: 50,
    timeout: 300000,  // 5 分钟
  },

  worker: {
    role: 'worker',
    description: '工作 Agent，执行延迟任务',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,  // 3 分钟
  },

  researcher: {
    role: 'researcher',
    description: '研究 Agent，只读检索 + 事实交叉验证（ADR 0024）',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'web_search', 'web_fetch',
      'cell_submit_artifact', 'cell_read_artifact', 'cell_pipeline_status',
    ],
    blockedTools: ['write_file', 'edit_file', 'bash', 'send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,
  },

  evaluator: {
    role: 'evaluator',
    description: '评估 Agent，纯逻辑推理与方案评估；只读文件 + artifact（ADR 0024）',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'cell_read_artifact', 'cell_submit_artifact', 'cell_pipeline_status',
    ],
    blockedTools: [
      'write_file', 'edit_file',
      'bash', 'web_search', 'web_fetch', 'send_message', 'spawn_subagent',
      'generate_image', 'analyze_media',
    ],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 8,
    maxToolCalls: 16,
    timeout: 180000,
  },

  executor: {
    role: 'executor',
    description: '执行 Agent，物理落地与工具调用（写/bash/MCP/生图）（ADR 0024）',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash',
      'generate_image', 'analyze_media',
      'cell_submit_artifact', 'cell_read_artifact', 'cell_pipeline_status',
    ],
    blockedTools: ['send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,
  },

  reviewer: {
    role: 'reviewer',
    description: '审查 Agent，质检合规；仅读 artifact 白名单（禁搜网/禁读 Evaluator CoT，ADR 0024）',
    // I2：跨角色数据只经 artifact；reviewer 不可 web_search / 不可读实现源 CoT
    allowedTools: ['cell_read_artifact', 'cell_submit_artifact', 'cell_pipeline_status'],
    blockedTools: [
      'read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch', 'send_message', 'spawn_subagent',
    ],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 8,
    maxToolCalls: 20,
    timeout: 180000,
  },

  planner: {
    role: 'planner',
    description: '规划 Agent，全局总控 + 动态路由（ADR 0024 director）',
    allowedTools: [
      'orchestration_start', 'orchestration_add_task', 'orchestration_status',
      'orchestration_complete', 'orchestration_retry_task', 'orchestration_skip_task',
      'spawn_task', 'ask_user',
    ],
    blockedTools: ['write_file', 'edit_file', 'bash', 'web_search', 'web_fetch', 'generate_image'],
    canSendMessage: true,
    canSpawnSubagents: true,
    canAccessMainHistory: true,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 12,
    maxToolCalls: 40,
    timeout: 300000,
  },
};

// ── Agent 任务定义 ────────────────────────────────────────────────────

export interface AgentTask {
  /** 任务 ID */
  id: string;
  /** 所属编排 run（硬编排模式） */
  runId?: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description: string;
  /** Agent 角色 */
  role: AgentRole;
  /** 任务目标 */
  goal: string;
  /** 上下文信息 */
  context?: Record<string, unknown>;
  /** 优先级 */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** 依赖的任务 ID */
  dependencies?: string[];
  /** 持久化任务状态 */
  status?: OrchestrationTaskStatus;
  /** 执行器：local / group mention / remote mesh */
  executorKind?: OrchestrationExecutorKind;
  remoteAgentId?: string;
  remoteTaskId?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

// ── Agent 执行结果 ────────────────────────────────────────────────────

export interface AgentResult {
  /** 任务 ID */
  taskId: string;
  /** Agent 角色 */
  role: AgentRole;
  /** 是否成功 */
  success: boolean;
  /** 结果摘要 */
  summary: string;
  /** 详细结果 */
  details?: unknown;
  /** 工具调用记录 */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
    duration: number;
  }>;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
  /** Token 使用情况 */
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

// ── Agent 调度器类 ────────────────────────────────────────────────────

export type AgentResultListener = (result: AgentResult) => void;

export class AgentDispatcher {
  private tasks: Map<string, AgentTask> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private running: Map<string, Promise<AgentResult>> = new Map();
  private taskTimestamps = new Map<string, number>();
  private resultListeners: AgentResultListener[] = [];
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private repository: OrchestrationRepository | null = null;

  private static readonly MAX_STORED_TASKS = 500;
  private static readonly TASK_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), AgentDispatcher.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  setRepository(repository: OrchestrationRepository | null): void {
    this.repository = repository;
  }

  onResult(listener: AgentResultListener): () => void {
    this.resultListeners.push(listener);
    return () => {
      this.resultListeners = this.resultListeners.filter((l) => l !== listener);
    };
  }

  /** 从 DB 记录同步到内存（硬编排 SSOT 写穿缓存） */
  syncTaskFromRecord(record: OrchestrationTaskRecord): void {
    const shape = taskRecordToAgentTaskShape(record);
    const task: AgentTask = {
      id: shape.id,
      runId: shape.runId,
      name: shape.name,
      description: shape.description,
      role: shape.role as AgentRole,
      goal: shape.goal,
      dependencies: shape.dependencies,
      priority: shape.priority,
      context: shape.context,
      status: shape.status,
      executorKind: shape.executorKind,
      remoteAgentId: shape.remoteAgentId,
      remoteTaskId: shape.remoteTaskId,
    };
    this.tasks.set(task.id, task);
    this.taskTimestamps.set(task.id, record.updated_at || Date.now());

    if (record.status === 'completed') {
      this.results.set(task.id, {
        taskId: task.id,
        role: task.role,
        success: true,
        summary: record.result_summary || 'completed',
        duration: (record.finished_at ?? record.updated_at) - (record.started_at ?? record.created_at),
      });
      this.running.delete(task.id);
    } else if (record.status === 'failed') {
      this.results.set(task.id, {
        taskId: task.id,
        role: task.role,
        success: false,
        summary: record.result_summary || 'failed',
        error: record.error,
        duration: (record.finished_at ?? record.updated_at) - (record.started_at ?? record.created_at),
      });
      this.running.delete(task.id);
    } else if (record.status === 'cancelled') {
      this.results.set(task.id, {
        taskId: task.id,
        role: task.role,
        success: true,
        summary: record.error || 'cancelled',
        duration: 0,
      });
      this.running.delete(task.id);
    } else if (record.status === 'running') {
      this.results.delete(task.id);
    } else {
      this.results.delete(task.id);
      this.running.delete(task.id);
    }
  }

  /**
   * 创建任务
   */
  createTask(task: Omit<AgentTask, 'id'> & { id?: string }): AgentTask {
    const id = task.id ?? randomUUID().slice(0, 8);
    const fullTask: AgentTask = { ...task, id, status: task.status ?? 'pending' };
    this.tasks.set(id, fullTask);
    this.taskTimestamps.set(id, Date.now());
    if (!fullTask.runId) {
      this.evictIfOverCapacity();
    }
    return fullTask;
  }

  /**
   * 释放任务元数据（仅用于无 runId 的临时 prompt 任务）
   */
  releaseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task?.runId) return;
    this.tasks.delete(taskId);
    this.results.delete(taskId);
    this.running.delete(taskId);
    this.taskTimestamps.delete(taskId);
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取任务结果
   */
  getResult(taskId: string): AgentResult | undefined {
    return this.results.get(taskId);
  }

  /**
   * 获取角色配置
   */
  getRoleConfig(role: AgentRole): AgentRoleConfig {
    return AGENT_ROLE_CONFIGS[role];
  }

  /**
   * 根据角色过滤工具
   */
  filterToolsByRole(tools: AgentTool[], role: AgentRole): AgentTool[] {
    const config = this.getRoleConfig(role);

    return tools.filter(tool => {
      // 检查是否在禁止列表中
      if (config.blockedTools.includes(tool.name)) {
        return false;
      }

      // 检查是否在允许列表中
      if (config.allowedTools.includes('*')) {
        return true;
      }

      return config.allowedTools.includes(tool.name);
    });
  }

  /**
   * 构建角色特定的系统提示词
   */
  buildRolePrompt(role: AgentRole, task: AgentTask): string {
    const config = this.getRoleConfig(role);

    const sections: string[] = [];

    // 角色定义
    sections.push(`# Agent Role: ${config.role}`);
    sections.push(config.description);

    // 任务目标
    sections.push('## Task');
    sections.push(`**Name:** ${task.name}`);
    sections.push(`**Description:** ${task.description}`);
    sections.push(`**Goal:** ${task.goal}`);

    // 权限说明
    sections.push('## Permissions');
    sections.push(`- Send message to user: ${config.canSendMessage ? 'YES' : 'NO'}`);
    sections.push(`- Spawn sub-agents: ${config.canSpawnSubagents ? 'YES' : 'NO'}`);
    sections.push(`- Access main history: ${config.canAccessMainHistory ? 'YES' : 'NO'}`);
    sections.push(`- Write files: ${config.canWrite ? 'YES' : 'NO'}`);
    sections.push(`- Execute dangerous operations: ${config.canExecuteDangerous ? 'YES' : 'NO'}`);

    // 工具限制
    sections.push('## Tool Restrictions');
    if (config.allowedTools.includes('*')) {
      sections.push('- All tools are allowed');
    } else {
      sections.push(`- Allowed tools: ${config.allowedTools.join(', ')}`);
    }
    if (config.blockedTools.length > 0) {
      sections.push(`- Blocked tools: ${config.blockedTools.join(', ')}`);
    }

    // 资源限制
    sections.push('## Resource Limits');
    sections.push(`- Max iterations: ${config.maxIterations}`);
    sections.push(`- Max tool calls: ${config.maxToolCalls}`);
    sections.push(`- Timeout: ${config.timeout / 1000} seconds`);

    // 上下文信息
    if (task.context) {
      sections.push('## Context');
      sections.push('```json');
      sections.push(JSON.stringify(task.context, null, 2));
      sections.push('```');
    }

    // 安全规则
    sections.push('## Safety Rules');
    sections.push('1. Always verify file paths before reading/writing');
    sections.push('2. Never execute commands that could harm the system');
    sections.push('3. If unsure, ask for clarification rather than guessing');
    sections.push('4. Report any errors or unexpected behavior immediately');
    sections.push('5. Respect the tool restrictions defined above');

    return sections.join('\n\n');
  }

  /**
   * 验证任务依赖
   */
  validateDependencies(task: AgentTask): { valid: boolean; reason?: string } {
    if (!task.dependencies || task.dependencies.length === 0) {
      return { valid: true };
    }

    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask) {
        return { valid: false, reason: `依赖任务 ${depId} 不存在` };
      }

      if (depTask.status === 'failed') {
        return { valid: false, reason: `依赖任务 ${depId} 已失败，需 retry 或 skip 后才能继续` };
      }

      const depResult = this.results.get(depId);
      if (!depResult) {
        return { valid: false, reason: `依赖任务 ${depId} 尚未完成` };
      }

      if (!depResult.success && depTask.status !== 'cancelled') {
        return { valid: false, reason: `依赖任务 ${depId} 执行失败` };
      }
    }

    return { valid: true };
  }

  /**
   * 检查任务是否可以执行
   */
  canExecute(taskId: string): { canExecute: boolean; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { canExecute: false, reason: '任务不存在' };
    }

    if (this.running.has(taskId)) {
      return { canExecute: false, reason: '任务已在运行中' };
    }

    if (this.results.has(taskId)) {
      return { canExecute: false, reason: '任务已完成' };
    }

    const depValidation = this.validateDependencies(task);
    if (!depValidation.valid) {
      return { canExecute: false, reason: depValidation.reason };
    }

    return { canExecute: true };
  }

  /**
   * 记录任务结果
   */
  recordResult(result: AgentResult): void {
    this.results.set(result.taskId, result);
    this.running.delete(result.taskId);
    const task = this.tasks.get(result.taskId);
    if (task) {
      task.status = result.success ? 'completed' : 'failed';
    }
    if (this.repository && task?.runId) {
      void this.repository.updateTaskStatus(
        result.taskId,
        result.success ? 'completed' : 'failed',
        {
          result_summary: result.summary,
          error: result.error ?? '',
          finished_at: Date.now(),
        },
      );
    }
    for (const listener of this.resultListeners) {
      try {
        listener(result);
      } catch {
        // ignore listener errors
      }
    }
  }

  /**
   * 标记任务为运行中
   */
  markRunning(taskId: string, promise: Promise<AgentResult>): void {
    this.running.set(taskId, promise);
    const task = this.tasks.get(taskId);
    if (task) task.status = 'running';
    if (this.repository && task?.runId) {
      void this.repository.updateTaskStatus(taskId, 'running', { started_at: Date.now() });
    }
  }

  async hydrateRun(runId: string): Promise<void> {
    if (!this.repository) return;
    const tasks = await this.repository.listTasksByRun(runId);
    for (const t of tasks) this.syncTaskFromRecord(t);
  }

  /**
   * 获取所有任务状态
   */
  getTaskStatus(): Array<{
    task: AgentTask;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: AgentResult;
  }> {
    const status: Array<{
      task: AgentTask;
      status: 'pending' | 'running' | 'completed' | 'failed';
      result?: AgentResult;
    }> = [];

    for (const [taskId, task] of this.tasks.entries()) {
      const result = this.results.get(taskId);
      const isRunning = this.running.has(taskId);

      let statusStr: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
      if (isRunning) {
        statusStr = 'running';
      } else if (result) {
        statusStr = result.success ? 'completed' : 'failed';
      }

      status.push({
        task,
        status: statusStr,
        result,
      });
    }

    return status;
  }

  /**
   * 清理已完成/过期任务，返回移除数量
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, result] of this.results.entries()) {
      const task = this.tasks.get(taskId);
      if (task?.runId) continue;
      if (result.success) {
        this.releaseTask(taskId);
        cleaned++;
      }
    }

    for (const [taskId, createdAt] of this.taskTimestamps.entries()) {
      const task = this.tasks.get(taskId);
      if (task?.runId) continue;
      if (now - createdAt > AgentDispatcher.TASK_TTL_MS) {
        this.releaseTask(taskId);
        cleaned++;
      }
    }

    cleaned += this.evictIfOverCapacity();
    return cleaned;
  }

  private evictIfOverCapacity(): number {
    let cleaned = 0;
    while (this.countEphemeralTasks() > AgentDispatcher.MAX_STORED_TASKS) {
      const ephemeral = [...this.taskTimestamps.entries()]
        .filter(([id]) => !this.tasks.get(id)?.runId)
        .sort((a, b) => a[1] - b[1])[0];
      if (!ephemeral) break;
      this.releaseTask(ephemeral[0]);
      cleaned++;
    }
    return cleaned;
  }

  private countEphemeralTasks(): number {
    let n = 0;
    for (const task of this.tasks.values()) {
      if (!task.runId) n += 1;
    }
    return n;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.resultListeners.length = 0;
    this.tasks.clear();
    this.results.clear();
    this.running.clear();
    this.taskTimestamps.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const [taskId] of this.tasks.entries()) {
      const result = this.results.get(taskId);
      const isRunning = this.running.has(taskId);

      if (isRunning) {
        running++;
      } else if (result) {
        if (result.success) {
          completed++;
        } else {
          failed++;
        }
      } else {
        pending++;
      }
    }

    return {
      totalTasks: this.tasks.size,
      pendingTasks: pending,
      runningTasks: running,
      completedTasks: completed,
      failedTasks: failed,
    };
  }
}

// ── 全局调度器实例 ────────────────────────────────────────────────────

let globalDispatcher: AgentDispatcher | null = null;

/**
 * 获取全局调度器实例
 */
export function getAgentDispatcher(): AgentDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new AgentDispatcher();
  }
  return globalDispatcher;
}

/**
 * 初始化调度器
 */
export function initAgentDispatcher(): AgentDispatcher {
  globalDispatcher?.dispose();
  globalDispatcher = new AgentDispatcher();
  return globalDispatcher;
}

/** 重置全局调度器（用于测试隔离） */
export function resetAgentDispatcher(): void {
  globalDispatcher = null;
}
