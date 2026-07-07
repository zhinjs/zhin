import { describe, expect, it } from 'vitest';
import { getAgentDispatcher } from '../../src/orchestrator/agent-dispatcher.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import type { AgentExecutor } from '../../src/orchestrator/orchestration-types.js';
import { createFiveAgentWorkflowStrategy } from '../../src/builtin/five-agent/index.js';

describe('OrchestrationKernel', () => {
  it('drives run/task state through events and snapshots', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const started = await kernel.startRun({ sessionKey: 's1', title: 'demo' });
    const dispatched = await kernel.dispatchTask({
      runId: started.run.id,
      name: 'answer',
      description: 'answer user',
      role: 'subtask',
      goal: 'answer user',
      executorKind: 'local',
      autoStart: false,
    });

    let snapshot = await kernel.getSnapshot(started.run.id);
    expect(snapshot.run.status).toBe('waiting');
    expect(dispatched.task.status).toBe('assigned');
    expect(snapshot.events.map((event) => event.type)).toEqual([
      'run.started',
      'task.created',
      'task.assigned',
      'run.status_changed',
    ]);

    const executor: AgentExecutor = {
      kind: 'local',
      execute: async function* () {
        yield { type: 'thinking', text: 'planning visible summary' };
        yield { type: 'progress', text: 'half way' };
        yield { type: 'result', result: 'done' };
      },
    };

    const task = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(task.status).toBe('completed');
    expect(task.resultSummary).toBe('done');

    snapshot = await kernel.getSnapshot(started.run.id);
    expect(snapshot.run.status).toBe('completed');
    expect(snapshot.tasks[0]?.status).toBe('completed');
    expect(snapshot.events.map((event) => event.type)).toContain('task.thinking');
    expect(snapshot.events.map((event) => event.type)).toContain('result.returned');
  });

  it('failTask is idempotent on terminal tasks', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 's2' });
    const task = await kernel.addTask({ runId: run.run.id, name: 'one' });

    await kernel.completeTask(task.id, 'ok');
    const again = await kernel.failTask(task.id, 'late error');
    expect(again.status).toBe('completed');
  });

  it('cancelTask cancels active mesh tasks', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 's-cancel' });
    const task = await kernel.addTask({ runId: run.run.id, name: 'mesh' });
    await kernel.repository.updateTaskStatus(task.id, 'running', { started_at: Date.now() });

    const cancelled = await kernel.cancelTask(task.id, 'user cancelled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toContain('user cancelled');
  });

  it('completes task when dispatcher recordResult precedes kernel result event', async () => {
    const repo = new MemoryOrchestrationRepository();
    const kernel = initOrchestrationService(repo);
    const dispatcher = getAgentDispatcher();
    dispatcher.setRepository(repo);

    const started = await kernel.startRun({ sessionKey: 'spawn-race' });
    const dispatched = await kernel.dispatchTask({
      runId: started.run.id,
      name: 'reviewer',
      description: '你好',
      role: 'subtask',
      goal: '你好',
      executorKind: 'local',
      assignedTo: 'reviewer',
      autoStart: false,
    });
    dispatcher.syncTaskFromRecord((await repo.getTask(dispatched.task.id))!);

    const executor: AgentExecutor = {
      kind: 'local',
      execute: async function* ({ task }) {
        dispatcher.recordResult({
          taskId: task.id,
          role: 'subtask',
          success: true,
          summary: '你好！有什么我可以帮你的吗？',
          duration: 1000,
        });
        yield { type: 'result', result: '你好！有什么我可以帮你的吗？' };
      },
    };

    const completed = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(completed.status).toBe('completed');
    expect(completed.resultSummary).toBe('你好！有什么我可以帮你的吗？');
  });

  it('plans five-agent workflow as an optional strategy', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy());

    const snapshot = await kernel.runWorkflowStrategy('five-agent', {
      sessionKey: 's3',
      content: 'ship the feature',
      autoStart: false,
    });

    expect(snapshot.tasks.map((task) => task.role)).toEqual([
      'planner',
      'researcher',
      'evaluator',
      'executor',
      'reviewer',
    ]);
    expect(snapshot.tasks[1]?.dependsOn).toEqual([snapshot.tasks[0]?.id]);
    expect(snapshot.tasks.every((task) => task.executorKind === 'local')).toBe(true);
  });
});
