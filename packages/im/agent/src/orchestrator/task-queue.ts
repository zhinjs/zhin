/**
 * 任务队列管理器
 *
 * 提供：
 * - 优先级队列
 * - 并发控制
 * - 超时和重试机制
 * - DAG 依赖管理
 */

import { randomUUID } from 'node:crypto';

// ── 任务状态定义 ──────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending'     // 等待执行
  | 'queued'      // 已加入队列
  | 'running'     // 正在执行
  | 'completed'   // 已完成
  | 'failed'      // 已失败
  | 'cancelled'   // 已取消
  | 'timeout'     // 已超时
  | 'retrying';   // 重试中

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// ── 任务定义 ──────────────────────────────────────────────────────────

export interface Task<T = unknown> {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description?: string;
  /** 任务优先级 */
  priority: TaskPriority;
  /** 任务状态 */
  status: TaskStatus;
  /** 任务执行函数 */
  execute: () => Promise<T>;
  /** 依赖的任务 ID */
  dependencies?: string[];
  /** 最大重试次数 */
  maxRetries?: number;
  /** 当前重试次数 */
  retryCount?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 创建时间 */
  createdAt: number;
  /** 开始执行时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 任务结果 */
  result?: T;
  /** 错误信息 */
  error?: Error;
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
}

// ── 队列配置 ──────────────────────────────────────────────────────────

export interface TaskQueueConfig {
  /** 最大并发数 */
  maxConcurrency: number;
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 默认最大重试次数 */
  defaultMaxRetries: number;
  /** 是否启用优先级 */
  enablePriority: boolean;
  /** 是否启用 DAG 依赖 */
  enableDAG: boolean;
  /** 任务过期时间（毫秒） */
  taskExpiration?: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrency: 5,
  defaultTimeout: 60000,
  defaultMaxRetries: 3,
  enablePriority: true,
  enableDAG: true,
};

// ── 优先级权重 ────────────────────────────────────────────────────────

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ── 任务队列类 ────────────────────────────────────────────────────────

export class TaskQueue {
  private config: TaskQueueConfig;
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private running: Set<string> = new Set();
  private completed: Set<string> = new Set();
  private listeners: Array<(event: string, task: Task) => void> = [];

  constructor(config: Partial<TaskQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 添加任务
   */
  addTask<T>(task: Omit<Task<T>, 'id' | 'status' | 'createdAt' | 'retryCount'>): Task<T> {
    const id = randomUUID().slice(0, 8);
    const fullTask: Task<T> = {
      ...task,
      id,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: task.maxRetries ?? this.config.defaultMaxRetries,
      timeout: task.timeout ?? this.config.defaultTimeout,
    };

    this.tasks.set(id, fullTask);
    this.enqueueTask(id);

    this.notifyListeners('task:added', fullTask);
    return fullTask;
  }

  /**
   * 获取任务
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  } {
    let pending = 0;
    let queued = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending':
          pending++;
          break;
        case 'queued':
          queued++;
          break;
        case 'running':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
        case 'timeout':
          failed++;
          break;
      }
    }

    return { pending, queued, running, completed, failed };
  }

  /**
   * 开始处理队列
   */
  async start(): Promise<void> {
    this.processQueue();
  }

  /**
   * 停止处理队列
   */
  stop(): void {
    // 取消所有运行中的任务
    for (const taskId of this.running) {
      this.cancelTask(taskId);
    }
  }

  /**
   * 取消任务
   */
  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (task.status === 'running') {
      this.running.delete(id);
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();

    this.notifyListeners('task:cancelled', task);
    return true;
  }

  /**
   * 重试任务
   */
  retryTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'failed') {
      return false;
    }

    task.status = 'retrying';
    task.retryCount = (task.retryCount || 0) + 1;

    this.enqueueTask(id);
    this.notifyListeners('task:retrying', task);
    return true;
  }

  /**
   * 添加事件监听器
   */
  on(event: string, listener: (task: Task) => void): void {
    this.listeners.push((e, task) => {
      if (e === event) {
        listener(task);
      }
    });
  }

  /**
   * 清理已完成的任务
   */
  cleanup(): void {
    const now = Date.now();
    const expiration = this.config.taskExpiration || 24 * 60 * 60 * 1000; // 24 hours

    for (const [taskId, task] of this.tasks.entries()) {
      if (
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        if (task.completedAt && now - task.completedAt > expiration) {
          this.tasks.delete(taskId);
          this.completed.delete(taskId);
        }
      }
    }
  }

  /**
   * 将任务加入队列
   */
  private enqueueTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }

    // 检查依赖是否满足
    if (this.config.enableDAG && task.dependencies && task.dependencies.length > 0) {
      const dependenciesMet = task.dependencies.every(depId => {
        const depTask = this.tasks.get(depId);
        return depTask && depTask.status === 'completed';
      });

      if (!dependenciesMet) {
        task.status = 'pending';
        return;
      }
    }

    task.status = 'queued';

    if (this.config.enablePriority) {
      // 按优先级插入
      const weight = PRIORITY_WEIGHTS[task.priority];
      let insertIndex = this.queue.length;

      for (let i = 0; i < this.queue.length; i++) {
        const queuedTask = this.tasks.get(this.queue[i]);
        if (queuedTask && PRIORITY_WEIGHTS[queuedTask.priority] < weight) {
          insertIndex = i;
          break;
        }
      }

      this.queue.splice(insertIndex, 0, id);
    } else {
      this.queue.push(id);
    }

    this.notifyListeners('task:queued', task);
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running.size < this.config.maxConcurrency) {
      const taskId = this.queue.shift();
      if (!taskId) {
        break;
      }

      this.executeTask(taskId);
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status === 'cancelled') {
      return;
    }

    task.status = 'running';
    task.startedAt = Date.now();
    this.running.add(id);

    this.notifyListeners('task:started', task);

    // 设置超时
    const timeoutId = task.timeout
      ? setTimeout(() => {
          this.handleTaskTimeout(id);
        }, task.timeout)
      : null;

    try {
      const result = await task.execute();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();

      this.running.delete(id);
      this.completed.add(id);

      this.notifyListeners('task:completed', task);

      // 检查是否有依赖此任务的任务可以执行
      this.checkDependentTasks(id);
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      task.error = error instanceof Error ? error : new Error(String(error));

      // 检查是否可以重试
      if (
        task.retryCount !== undefined &&
        task.maxRetries !== undefined &&
        task.retryCount < task.maxRetries
      ) {
        task.status = 'retrying';
        task.retryCount++;

        this.running.delete(id);
        this.enqueueTask(id);

        this.notifyListeners('task:retrying', task);
      } else {
        task.status = 'failed';
        task.completedAt = Date.now();

        this.running.delete(id);

        this.notifyListeners('task:failed', task);
      }
    }

    // 继续处理队列
    this.processQueue();
  }

  /**
   * 处理任务超时
   */
  private handleTaskTimeout(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') {
      return;
    }

    task.status = 'timeout';
    task.completedAt = Date.now();
    task.error = new Error(`Task timeout after ${task.timeout}ms`);

    this.running.delete(id);

    this.notifyListeners('task:timeout', task);

    // 继续处理队列
    this.processQueue();
  }

  /**
   * 检查依赖任务
   */
  private checkDependentTasks(completedTaskId: string): void {
    for (const [taskId, task] of this.tasks.entries()) {
      if (
        task.status === 'pending' &&
        task.dependencies &&
        task.dependencies.includes(completedTaskId)
      ) {
        this.enqueueTask(taskId);
      }
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: string, task: Task): void {
    for (const listener of this.listeners) {
      try {
        listener(event, task);
      } catch (error) {
        console.error('[TaskQueue] Listener error:', error);
      }
    }
  }
}

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalTaskQueue: TaskQueue | null = null;

/**
 * 获取全局任务队列
 */
export function getTaskQueue(): TaskQueue {
  if (!globalTaskQueue) {
    globalTaskQueue = new TaskQueue();
  }
  return globalTaskQueue;
}

/**
 * 初始化任务队列
 */
export function initTaskQueue(config: Partial<TaskQueueConfig>): TaskQueue {
  globalTaskQueue = new TaskQueue(config);
  return globalTaskQueue;
}
