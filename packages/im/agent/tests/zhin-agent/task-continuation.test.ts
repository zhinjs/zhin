import { describe, it, expect, beforeEach } from 'vitest';
import {
  TaskContinuationManager,
  decomposeTask,
  initContinuationManager,
  getContinuationManager,
} from '../../src/turn/task-continuation.js';

describe('TaskContinuationManager', () => {
  let manager: TaskContinuationManager;

  beforeEach(() => {
    manager = new TaskContinuationManager();
  });

  describe('基本功能', () => {
    it('应该创建管理器', () => {
      expect(manager).toBeDefined();
    });

    it('应该创建任务', () => {
      const task = manager.createTask('task-1', 'Test task', ['step1', 'step2']);

      expect(task.taskId).toBe('task-1');
      expect(task.description).toBe('Test task');
      expect(task.status).toBe('in_progress');
      expect(task.pendingSteps).toEqual(['step1', 'step2']);
      expect(task.completedSteps).toEqual([]);
    });

    it('应该获取任务', () => {
      manager.createTask('task-1', 'Test task');

      const task = manager.getTask('task-1');
      expect(task).toBeDefined();
      expect(task?.taskId).toBe('task-1');
    });

    it('应该获取所有任务', () => {
      manager.createTask('task-1', 'Task 1');
      manager.createTask('task-2', 'Task 2');

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(2);
    });

    it('应该获取活跃任务', () => {
      manager.createTask('task-1', 'Task 1');
      manager.createTask('task-2', 'Task 2');
      manager.setStatus('task-2', 'completed');

      const activeTasks = manager.getActiveTasks();
      expect(activeTasks.length).toBe(1);
      expect(activeTasks[0].taskId).toBe('task-1');
    });
  });

  describe('进度更新', () => {
    it('应该完成步骤', () => {
      const task = manager.createTask('task-1', 'Test task', ['step1', 'step2', 'step3']);

      manager.completeStep('task-1', 'step1');

      const updated = manager.getTask('task-1');
      expect(updated?.completedSteps).toContain('step1');
      expect(updated?.pendingSteps).not.toContain('step1');
      expect(updated?.progress).toBe(33);
    });

    it('应该添加新步骤', () => {
      const task = manager.createTask('task-1', 'Test task', ['step1']);

      manager.addSteps('task-1', ['step2', 'step3']);

      const updated = manager.getTask('task-1');
      expect(updated?.pendingSteps).toContain('step2');
      expect(updated?.pendingSteps).toContain('step3');
    });

    it('应该更新使用量', () => {
      manager.createTask('task-1', 'Test task');

      manager.updateUsage('task-1', {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });

      const updated = manager.getTask('task-1');
      expect(updated?.totalUsage.prompt_tokens).toBe(100);
      expect(updated?.totalUsage.completion_tokens).toBe(50);
      expect(updated?.totalUsage.total_tokens).toBe(150);
    });

    it('应该增加迭代次数', () => {
      manager.createTask('task-1', 'Test task');

      manager.incrementIterations('task-1');
      manager.incrementIterations('task-1');

      const updated = manager.getTask('task-1');
      expect(updated?.totalIterations).toBe(2);
    });

    it('应该更新执行时间', () => {
      manager.createTask('task-1', 'Test task');

      manager.updateTime('task-1', 1000);
      manager.updateTime('task-1', 2000);

      const updated = manager.getTask('task-1');
      expect(updated?.totalTime).toBe(3000);
    });

    it('应该添加上下文消息', () => {
      manager.createTask('task-1', 'Test task');

      manager.addContextMessage('task-1', {
        role: 'user',
        content: 'Hello',
      });

      const updated = manager.getTask('task-1');
      expect(updated?.contextMessages.length).toBe(1);
      expect(updated?.contextMessages[0].role).toBe('user');
    });
  });

  describe('任务状态', () => {
    it('应该设置任务状态', () => {
      manager.createTask('task-1', 'Test task');

      manager.setStatus('task-1', 'partial');

      const updated = manager.getTask('task-1');
      expect(updated?.status).toBe('partial');
    });

    it('应该自动标记完成', () => {
      const task = manager.createTask('task-1', 'Test task', ['step1', 'step2']);

      manager.completeStep('task-1', 'step1');
      manager.completeStep('task-1', 'step2');

      const updated = manager.getTask('task-1');
      expect(updated?.status).toBe('completed');
      expect(updated?.progress).toBe(100);
    });
  });

  describe('任务续传', () => {
    it('应该检查任务是否可以续传', () => {
      manager.createTask('task-1', 'Test task', ['step1', 'step2']);
      manager.setStatus('task-1', 'max_iterations');

      expect(manager.canContinue('task-1')).toBe(true);
    });

    it('应该准备续传上下文', () => {
      manager.createTask('task-1', 'Test task', ['step1', 'step2']);
      manager.setStatus('task-1', 'max_iterations');
      manager.completeStep('task-1', 'step1');

      const continuation = manager.prepareContinuation('task-1');

      expect(continuation.canContinue).toBe(true);
      expect(continuation.remainingSteps).toContain('step2');
      expect(continuation.progress).toBe(50);
    });

    it('应该不允许已完成任务续传', () => {
      manager.createTask('task-1', 'Test task', ['step1']);
      manager.completeStep('task-1', 'step1');

      expect(manager.canContinue('task-1')).toBe(false);
    });
  });

  describe('任务管理', () => {
    it('应该删除任务', () => {
      manager.createTask('task-1', 'Test task');

      const deleted = manager.deleteTask('task-1');
      expect(deleted).toBe(true);

      const task = manager.getTask('task-1');
      expect(task).toBeUndefined();
    });

    it('应该清除所有任务', () => {
      manager.createTask('task-1', 'Task 1');
      manager.createTask('task-2', 'Task 2');

      manager.clearAll();

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(0);
    });

    it('应该限制存储的任务数量', () => {
      const manager = new TaskContinuationManager(2);

      manager.createTask('task-1', 'Task 1');
      manager.createTask('task-2', 'Task 2');
      manager.createTask('task-3', 'Task 3');

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBeLessThanOrEqual(2);
    });
  });
});

describe('decomposeTask', () => {
  it('应该分解简单任务', () => {
    const decomposition = decomposeTask('查看当前目录的文件');

    expect(decomposition.mainTask).toBe('查看当前目录的文件');
    expect(decomposition.subtasks.length).toBeGreaterThan(0);
    expect(decomposition.totalEstimatedIterations).toBeGreaterThan(0);
  });

  it('应该分解中等任务', () => {
    const decomposition = decomposeTask('创建一个新的配置文件');

    expect(decomposition.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(decomposition.totalEstimatedIterations).toBeGreaterThanOrEqual(4);
  });

  it('应该分解复杂任务', () => {
    const decomposition = decomposeTask('实现一个完整的用户认证系统');

    expect(decomposition.subtasks.length).toBeGreaterThanOrEqual(4);
    expect(decomposition.totalEstimatedIterations).toBeGreaterThanOrEqual(8);
  });

  it('应该包含依赖关系', () => {
    const decomposition = decomposeTask('实现一个功能');

    const implementation = decomposition.subtasks.find(s => s.id === 'implementation');
    expect(implementation).toBeDefined();
    expect(implementation?.dependencies.length).toBeGreaterThan(0);
  });
});

describe('全局实例', () => {
  it('应该获取全局实例', () => {
    const instance = getContinuationManager();
    expect(instance).toBeDefined();
  });

  it('应该初始化全局实例', () => {
    const instance = initContinuationManager(50);
    expect(instance).toBeDefined();
  });
});
