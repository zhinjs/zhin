import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { tryHandlePeerInboundHandback } from '../../src/collaboration/inbound-peer-handback.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

describe('tryHandlePeerInboundHandback', () => {
  const cell: CollaborationScene = {
    id: 'cell-handback',
    adapter: 'icqq',
    sceneId: '129043431',
    goal: 'test',
    members: [
      { endpointId: 'planner-bot', primary: 'planner', pipelineRole: 'planner' },
      { endpointId: 'worker-bot', primary: 'researcher', pipelineRole: 'researcher' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes im_projection task when peer replies with #taskId and substantive summary', async () => {
    const baseMessage = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'worker-bot',
      scope: 'group',
      sceneId: '129043431',
    });

    const repo = new MemoryOrchestrationRepository();
    const orch = initOrchestrationService(repo);
    const run = await orch.startRun({ sessionKey: resolveIMSessionIdFromMessage(baseMessage) });
    const dispatched = await orch.dispatchTask({
      runId: run.run.id,
      name: '@worker-bot',
      executorKind: 'im_projection',
      assignedTo: 'worker-bot',
      autoStart: false,
    });
    await orch.runTask(dispatched.task.id, undefined, {
      kind: 'im_projection',
      async *execute() {
        yield { type: 'progress', text: 'waiting' };
      },
    });

    const taskId = dispatched.task.id;
    const message = {
      ...baseMessage,
      $content: [{ type: 'text', data: { text: `#${taskId} 调研结论：市场增长 12%` } }],
    };

    const replies: unknown[] = [];
    const stopped = await tryHandlePeerInboundHandback({
      message,
      cell,
      peerEndpointId: 'worker-bot',
      replyAi: async (payload) => { replies.push(payload); },
      logger: { debug: vi.fn(), info: vi.fn() },
    });

    expect(stopped).toBe(false);
    expect(replies).toEqual([]);
    const task = await repo.getTask(dispatched.task.id);
    expect(task?.status).toBe('completed');
    expect(task?.result_summary).toContain('调研结论');
  });

  it('returns early with hint when multiple active tasks and no #taskId', async () => {
    const message = {
      ...mockCommMessage({
        adapter: 'icqq',
        endpoint: 'worker-bot',
        scope: 'group',
        sceneId: '129043431',
      }),
      $content: [{ type: 'text', data: { text: '任务完成了' } }],
    };

    const repo = new MemoryOrchestrationRepository();
    const orch = initOrchestrationService(repo);
    const run = await orch.startRun({ sessionKey: resolveIMSessionIdFromMessage(message) });
    for (const name of ['t1', 't2']) {
      const dispatched = await orch.dispatchTask({
        runId: run.run.id,
        name,
        executorKind: 'im_projection',
        assignedTo: 'worker-bot',
        autoStart: false,
      });
      await orch.runTask(dispatched.task.id, undefined, {
        kind: 'im_projection',
        async *execute() {
          yield { type: 'progress', text: 'waiting' };
        },
      });
    }

    const replies: unknown[] = [];
    const stopped = await tryHandlePeerInboundHandback({
      message,
      cell,
      peerEndpointId: 'worker-bot',
      replyAi: async (payload) => { replies.push(payload); },
      logger: { debug: vi.fn(), info: vi.fn() },
    });

    expect(stopped).toBe(true);
    expect(String(replies[0])).toContain('活跃任务');
  });
});
