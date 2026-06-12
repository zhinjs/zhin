/**
 * 任务续传机制
 *
 * 当 Agent 达到迭代次数限制但任务未完成时，
 * 提供智能的任务续传能力。
 */

import type { AgentMessage, Usage } from '@zhin.js/ai';
import type { ZhinAgentConfig } from './config.js';

// ── 任务状态定义 ──────────────────────────────────────────────────────

export type TaskStatus =
  | 'in_progress'    // 进行中
  | 'completed'      // 已完成
  | 'partial'        // 部分完成
  | 'failed'         // 失败
  | 'timeout'        // 超时
  | 'max_iterations' // 达到最大迭代次数

export interface TaskProgress {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  description: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 完成百分比（0-100） */
  progress: number;
  /** 已完成的步骤 */
  completedSteps: string[];
  /** 待完成的步骤 */
  pendingSteps: string[];
  /** 当前步骤 */
  currentStep?: string;
  /** 累计 Token 使用 */
  totalUsage: Usage;
  /** 累计迭代次数 */
  totalIterations: number;
  /** 累计时间（毫秒） */
  totalTime: number;
  /** 上下文消息 */
  contextMessages: AgentMessage[];
  /** 最后一次执行结果 */
  lastResult?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// 重新导出 Usage 类型
export type { Usage } from '@zhin.js/ai';

// ── 任务续传管理器 ────────────────────────────────────────────────────

export class TaskContinuationManager {
  private tasks: Map<string, TaskProgress> = new Map();
  private maxStoredTasks: number;

  constructor(maxStoredTasks: number = 100) {
    this.maxStoredTasks = maxStoredTasks;
  }

  /**
   * 创建新任务
   */
  createTask(
    taskId: string,
    description: string,
    initialSteps: string[] = [],
  ): TaskProgress {
    const task: TaskProgress = {
      taskId,
      description,
      status: 'in_progress',
      progress: 0,
      completedSteps: [],
      pendingSteps: [...initialSteps],
      totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      totalIterations: 0,
      totalTime: 0,
      contextMessages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    this.cleanup();

    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): TaskProgress | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskProgress[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取活跃任务
   */
  getActiveTasks(): TaskProgress[] {
    return Array.from(this.tasks.values()).filter(
      t => t.status === 'in_progress' || t.status === 'partial'
    );
  }

  /**
   * 更新任务进度
   */
  updateProgress(
    taskId: string,
    updates: Partial<TaskProgress>,
  ): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updatedTask = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  /**
   * 标记步骤完成
   */
  completeStep(taskId: string, step: string): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    // 从待完成列表移除
    task.pendingSteps = task.pendingSteps.filter(s => s !== step);

    // 添加到已完成列表
    if (!task.completedSteps.includes(step)) {
      task.completedSteps.push(step);
    }

    // 更新进度
    const totalSteps = task.completedSteps.length + task.pendingSteps.length;
    task.progress = totalSteps > 0
      ? Math.round((task.completedSteps.length / totalSteps) * 100)
      : 0;

    // 检查是否全部完成
    if (task.pendingSteps.length === 0) {
      task.status = 'completed';
      task.progress = 100;
    }

    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 添加新步骤
   */
  addSteps(taskId: string, steps: string[]): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    for (const step of steps) {
      if (!task.pendingSteps.includes(step) && !task.completedSteps.includes(step)) {
        task.pendingSteps.push(step);
      }
    }

    // 重新计算进度
    const totalSteps = task.completedSteps.length + task.pendingSteps.length;
    task.progress = totalSteps > 0
      ? Math.round((task.completedSteps.length / totalSteps) * 100)
      : 0;

    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 更新使用量
   */
  updateUsage(taskId: string, usage: Usage): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    task.totalUsage = {
      prompt_tokens: task.totalUsage.prompt_tokens + usage.prompt_tokens,
      completion_tokens: task.totalUsage.completion_tokens + usage.completion_tokens,
      total_tokens: task.totalUsage.total_tokens + usage.total_tokens,
    };

    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 更新迭代次数
   */
  incrementIterations(taskId: string): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    task.totalIterations++;
    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 更新执行时间
   */
  updateTime(taskId: string, duration: number): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    task.totalTime += duration;
    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 添加上下文消息
   */
  addContextMessage(taskId: string, message: AgentMessage): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    task.contextMessages.push(message);
    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 设置任务状态
   */
  setStatus(taskId: string, status: TaskStatus): TaskProgress | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    task.status = status;
    task.updatedAt = Date.now();
    return task;
  }

  /**
   * 检查任务是否可以续传
   */
  canContinue(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    // 只有部分完成或达到迭代限制的任务可以续传
    return (
      task.status === 'partial' ||
      task.status === 'max_iterations'
    ) && task.pendingSteps.length > 0;
  }

  /**
   * 准备续传上下文
   */
  prepareContinuation(taskId: string): {
    canContinue: boolean;
    contextMessages: AgentMessage[];
    remainingSteps: string[];
    currentStep?: string;
    progress: number;
  } {
    const task = this.tasks.get(taskId);
    if (!task || !this.canContinue(taskId)) {
      return {
        canContinue: false,
        contextMessages: [],
        remainingSteps: [],
        progress: 0,
      };
    }

    return {
      canContinue: true,
      contextMessages: task.contextMessages,
      remainingSteps: task.pendingSteps,
      currentStep: task.pendingSteps[0],
      progress: task.progress,
    };
  }

  /**
   * 清理过期任务
   */
  private cleanup(): void {
    const now = Date.now();
    const completedTtlMs = 7 * 24 * 60 * 60 * 1000;
    for (const [taskId, task] of this.tasks) {
      if (
        (task.status === 'completed' || task.status === 'failed') &&
        now - task.updatedAt > completedTtlMs
      ) {
        this.tasks.delete(taskId);
      }
    }

    if (this.tasks.size <= this.maxStoredTasks) {
      return;
    }

    const sortedTasks = Array.from(this.tasks.entries())
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const tasksToKeep = sortedTasks.slice(0, this.maxStoredTasks);
    this.tasks = new Map(tasksToKeep);
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  /**
   * 清除所有任务
   */
  clearAll(): void {
    this.tasks.clear();
  }
}

// ── 任务分解器 ────────────────────────────────────────────────────────

export interface TaskDecomposition {
  /** 主任务 */
  mainTask: string;
  /** 子任务列表 */
  subtasks: Array<{
    id: string;
    description: string;
    dependencies: string[];
    estimatedIterations: number;
  }>;
  /** 总预估迭代次数 */
  totalEstimatedIterations: number;
}

/**
 * 智能任务分解
 */
export function decomposeTask(taskDescription: string): TaskDecomposition {
  // 分析任务复杂度
  const complexity = analyzeTaskComplexity(taskDescription);

  // 根据复杂度分解任务
  const subtasks = generateSubtasks(taskDescription, complexity);

  // 计算总预估迭代次数
  const totalEstimatedIterations = subtasks.reduce(
    (sum, st) => sum + st.estimatedIterations,
    0
  );

  return {
    mainTask: taskDescription,
    subtasks,
    totalEstimatedIterations,
  };
}

/**
 * 分析任务复杂度
 */
function analyzeTaskComplexity(taskDescription: string): 'simple' | 'medium' | 'complex' {
  const keywords = {
    simple: ['查询', '查看', '显示', '列出', '获取', 'read', 'list', 'show', 'get'],
    medium: ['创建', '修改', '更新', '删除', '配置', 'create', 'modify', 'update', 'delete', 'configure'],
    complex: ['实现', '开发', '设计', '重构', '迁移', '集成', 'implement', 'develop', 'design', 'refactor', 'migrate', 'integrate'],
  };

  const lowerTask = taskDescription.toLowerCase();

  // 检查复杂关键词
  for (const keyword of keywords.complex) {
    if (lowerTask.includes(keyword)) {
      return 'complex';
    }
  }

  // 检查中等关键词
  for (const keyword of keywords.medium) {
    if (lowerTask.includes(keyword)) {
      return 'medium';
    }
  }

  return 'simple';
}

/**
 * 生成子任务
 */
function generateSubtasks(
  taskDescription: string,
  complexity: 'simple' | 'medium' | 'complex',
): TaskDecomposition['subtasks'] {
  const subtasks: TaskDecomposition['subtasks'] = [];

  // 分析阶段
  subtasks.push({
    id: 'analysis',
    description: '分析任务需求和当前环境',
    dependencies: [],
    estimatedIterations: complexity === 'simple' ? 1 : 2,
  });

  // 设计阶段（复杂任务）
  if (complexity === 'complex') {
    subtasks.push({
      id: 'design',
      description: '设计方案和技术选型',
      dependencies: ['analysis'],
      estimatedIterations: 2,
    });
  }

  // 实现阶段
  subtasks.push({
    id: 'implementation',
    description: '实现核心功能',
    dependencies: complexity === 'complex' ? ['design'] : ['analysis'],
    estimatedIterations: complexity === 'simple' ? 2 : complexity === 'medium' ? 4 : 6,
  });

  // 测试阶段
  subtasks.push({
    id: 'testing',
    description: '测试和验证',
    dependencies: ['implementation'],
    estimatedIterations: complexity === 'simple' ? 1 : 2,
  });

  // 文档阶段（复杂任务）
  if (complexity === 'complex') {
    subtasks.push({
      id: 'documentation',
      description: '编写文档和示例',
      dependencies: ['testing'],
      estimatedIterations: 2,
    });
  }

  return subtasks;
}

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalContinuationManager: TaskContinuationManager | null = null;

/**
 * 获取全局任务续传管理器
 */
export function getContinuationManager(): TaskContinuationManager {
  if (!globalContinuationManager) {
    globalContinuationManager = new TaskContinuationManager();
  }
  return globalContinuationManager;
}

/**
 * 初始化任务续传管理器
 */
export function initContinuationManager(maxStoredTasks?: number): TaskContinuationManager {
  globalContinuationManager = new TaskContinuationManager(maxStoredTasks);
  return globalContinuationManager;
}
