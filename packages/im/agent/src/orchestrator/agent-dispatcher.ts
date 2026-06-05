/**
 * Agent 调度器
 *
 * - 明确的角色定义和权限继承
 * - 工具权限的精细化控制
 * - 上下文隔离和结果聚合
 * - 统一的错误处理和监控
 */

import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@zhin.js/core';

// ── Agent 角色定义 ────────────────────────────────────────────────────

export type AgentRole =
  | 'main'           // 主 Agent（用户交互）
  | 'subtask'        // 子任务 Agent（后台执行）
  | 'worker'         // 工作 Agent（延迟任务）
  | 'researcher'     // 研究 Agent（只读）
  | 'executor'       // 执行 Agent（写操作）
  | 'reviewer'       // 审查 Agent（只读+分析）
  | 'planner';       // 规划 Agent（只读+规划）

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
  main: {
    role: 'main',
    description: '主 Agent，负责用户交互和任务编排',
    allowedTools: ['*'],  // 所有工具
    blockedTools: [],
    canSendMessage: true,
    canSpawnSubagents: true,
    canAccessMainHistory: true,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 20,
    maxToolCalls: 100,
    timeout: 600000,  // 10 分钟
  },

  subtask: {
    role: 'subtask',
    description: '子任务 Agent，后台执行特定任务',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent', 'activate_skill'],
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
    description: '研究 Agent，只读分析',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'web_search', 'web_fetch',
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

  executor: {
    role: 'executor',
    description: '执行 Agent，执行写操作',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash',
    ],
    blockedTools: ['web_search', 'web_fetch', 'send_message', 'spawn_subagent'],
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
    description: '审查 Agent，只读分析',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'web_search', 'web_fetch',
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

  planner: {
    role: 'planner',
    description: '规划 Agent，只读规划',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'web_search', 'web_fetch',
    ],
    blockedTools: ['write_file', 'edit_file', 'bash', 'send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 5,
    maxToolCalls: 20,
    timeout: 120000,
  },
};

// ── Agent 任务定义 ────────────────────────────────────────────────────

export interface AgentTask {
  /** 任务 ID */
  id: string;
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

export class AgentDispatcher {
  private tasks: Map<string, AgentTask> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private running: Map<string, Promise<AgentResult>> = new Map();
  private taskTimestamps = new Map<string, number>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  private static readonly MAX_STORED_TASKS = 500;
  private static readonly TASK_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), AgentDispatcher.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 创建任务
   */
  createTask(task: Omit<AgentTask, 'id'>): AgentTask {
    const id = randomUUID().slice(0, 8);
    const fullTask: AgentTask = { ...task, id };
    this.tasks.set(id, fullTask);
    this.taskTimestamps.set(id, Date.now());
    this.evictIfOverCapacity();
    return fullTask;
  }

  /**
   * 释放任务元数据（子 Agent 仅借用调度器生成 prompt 时应在 finally 中调用）
   */
  releaseTask(taskId: string): void {
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

      const depResult = this.results.get(depId);
      if (!depResult) {
        return { valid: false, reason: `依赖任务 ${depId} 尚未完成` };
      }

      if (!depResult.success) {
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

    // 检查是否已在运行
    if (this.running.has(taskId)) {
      return { canExecute: false, reason: '任务已在运行中' };
    }

    // 检查是否已完成
    if (this.results.has(taskId)) {
      return { canExecute: false, reason: '任务已完成' };
    }

    // 检查依赖
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
  }

  /**
   * 标记任务为运行中
   */
  markRunning(taskId: string, promise: Promise<AgentResult>): void {
    this.running.set(taskId, promise);
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
      if (result.success) {
        this.releaseTask(taskId);
        cleaned++;
      }
    }

    for (const [taskId, createdAt] of this.taskTimestamps.entries()) {
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
    while (this.tasks.size > AgentDispatcher.MAX_STORED_TASKS) {
      const oldest = [...this.taskTimestamps.entries()].sort((a, b) => a[1] - b[1])[0];
      if (!oldest) break;
      this.releaseTask(oldest[0]);
      cleaned++;
    }
    return cleaned;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
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
  globalDispatcher = new AgentDispatcher();
  return globalDispatcher;
}
