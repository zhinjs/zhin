import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TaskQueue,
  initTaskQueue,
  getTaskQueue,
} from '../../src/orchestrator/task-queue.js';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({
      maxConcurrency: 2,
      defaultTimeout: 5000,
      defaultMaxRetries: 2,
      enablePriority: true,
      enableDAG: true,
    });
  });

  afterEach(() => {
    queue.stop();
  });

  describe('基本功能', () => {
    it('应该创建队列', () => {
      expect(queue).toBeDefined();
    });

    it('应该添加任务', () => {
      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => 'result',
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test Task');
      // 任务添加后会自动加入队列，状态为 'queued'
      expect(['pending', 'queued']).toContain(task.status);
    });

    it('应该获取任务', () => {
      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => 'result',
      });

      const retrieved = queue.getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Task');
    });

    it('应该获取所有任务', () => {
      queue.addTask({
        name: 'Task 1',
        priority: 'medium',
        execute: async () => 'result 1',
      });

      queue.addTask({
        name: 'Task 2',
        priority: 'high',
        execute: async () => 'result 2',
      });

      const tasks = queue.getAllTasks();
      expect(tasks.length).toBe(2);
    });

    it('应该获取队列状态', () => {
      queue.addTask({
        name: 'Task 1',
        priority: 'medium',
        execute: async () => 'result 1',
      });

      const status = queue.getQueueStatus();
      expect(status.pending).toBeGreaterThanOrEqual(0);
      expect(status.queued).toBeGreaterThanOrEqual(0);
      expect(status.running).toBeGreaterThanOrEqual(0);
      expect(status.completed).toBeGreaterThanOrEqual(0);
      expect(status.failed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('任务执行', () => {
    it('应该执行任务', async () => {
      let executed = false;

      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => {
          executed = true;
          return 'result';
        },
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(executed).toBe(true);
      expect(task.status).toBe('completed');
      expect(task.result).toBe('result');
    });

    it('应该处理任务失败', async () => {
      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => {
          throw new Error('Task failed');
        },
        maxRetries: 0,
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(task.status).toBe('failed');
      expect(task.error?.message).toBe('Task failed');
    });

    it('应该重试失败的任务', async () => {
      let attempts = 0;

      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Task failed');
          }
          return 'success';
        },
        maxRetries: 3,
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(attempts).toBe(3);
      expect(task.status).toBe('completed');
      expect(task.result).toBe('success');
    });

    it('应该处理任务超时', async () => {
      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
          return 'result';
        },
        timeout: 100,
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(task.status).toBe('timeout');
      expect(task.error?.message).toContain('timeout');
    });
  });

  describe('优先级队列', () => {
    it('应该按优先级执行任务', async () => {
      const executionOrder: string[] = [];

      queue.addTask({
        name: 'Low Priority',
        priority: 'low',
        execute: async () => {
          executionOrder.push('low');
          return 'low';
        },
      });

      queue.addTask({
        name: 'High Priority',
        priority: 'high',
        execute: async () => {
          executionOrder.push('high');
          return 'high';
        },
      });

      queue.addTask({
        name: 'Critical Priority',
        priority: 'critical',
        execute: async () => {
          executionOrder.push('critical');
          return 'critical';
        },
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 高优先级应该先执行
      expect(executionOrder[0]).toBe('critical');
      expect(executionOrder[1]).toBe('high');
      expect(executionOrder[2]).toBe('low');
    });
  });

  describe('DAG 依赖', () => {
    it('应该等待依赖任务完成', async () => {
      const executionOrder: string[] = [];

      const task1 = queue.addTask({
        name: 'Task 1',
        priority: 'medium',
        execute: async () => {
          executionOrder.push('task1');
          return 'result1';
        },
      });

      const task2 = queue.addTask({
        name: 'Task 2',
        priority: 'medium',
        execute: async () => {
          executionOrder.push('task2');
          return 'result2';
        },
        dependencies: [task1.id],
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(executionOrder[0]).toBe('task1');
      expect(executionOrder[1]).toBe('task2');
      expect(task2.status).toBe('completed');
    });
  });

  describe('任务取消', () => {
    it('应该取消任务', () => {
      const task = queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => 'result',
      });

      const cancelled = queue.cancelTask(task.id);
      expect(cancelled).toBe(true);
      expect(task.status).toBe('cancelled');
    });
  });

  describe('事件监听', () => {
    it('应该触发事件', async () => {
      const events: string[] = [];

      queue.on('task:added', () => events.push('added'));
      queue.on('task:queued', () => events.push('queued'));
      queue.on('task:started', () => events.push('started'));
      queue.on('task:completed', () => events.push('completed'));

      queue.addTask({
        name: 'Test Task',
        priority: 'medium',
        execute: async () => 'result',
      });

      await queue.start();

      // 等待任务执行完成
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toContain('added');
      expect(events).toContain('queued');
      expect(events).toContain('started');
      expect(events).toContain('completed');
    });
  });

  describe('并发控制', () => {
    it('应该限制并发数', async () => {
      let runningCount = 0;
      let maxRunningCount = 0;

      const createTask = (name: string) => queue.addTask({
        name,
        priority: 'medium',
        execute: async () => {
          runningCount++;
          maxRunningCount = Math.max(maxRunningCount, runningCount);
          await new Promise(resolve => setTimeout(resolve, 100));
          runningCount--;
          return name;
        },
      });

      // 添加 5 个任务，但并发数为 2
      createTask('Task 1');
      createTask('Task 2');
      createTask('Task 3');
      createTask('Task 4');
      createTask('Task 5');

      await queue.start();

      // 等待所有任务执行完成
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(maxRunningCount).toBeLessThanOrEqual(2);
    });
  });

  describe('全局实例', () => {
    it('应该获取全局实例', () => {
      const instance = getTaskQueue();
      expect(instance).toBeDefined();
    });

    it('应该初始化全局实例', () => {
      const instance = initTaskQueue({ maxConcurrency: 10 });
      expect(instance).toBeDefined();
    });
  });
});
