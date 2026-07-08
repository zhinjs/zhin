import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { tryCompleteKernelGroupMentionFromOutbound } from '../../src/collaboration/collaboration-kernel-bridge.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

vi.mock('../../src/collaboration/im-mention-delegate.js', () => ({
  sendGroupPeerMention: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('tryCompleteKernelGroupMentionFromOutbound', () => {
  const cell: CollaborationScene = {
    id: 'cell-1',
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

  it('completes single active im_projection task from substantive outbound', async () => {
    const message = mockCommMessage({
      adapter: 'icqq',
      endpoint: 'worker-bot',
      scope: 'group',
      sceneId: '129043431',
    });

    const repo = new MemoryOrchestrationRepository();
    const orch = initOrchestrationService(repo);
    const run = await orch.startRun({ sessionKey: resolveIMSessionIdFromMessage(message) });
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

    await tryCompleteKernelGroupMentionFromOutbound({
      message,
      cell,
      endpointId: 'worker-bot',
      outboundBatches: [[{ type: 'text', data: { text: '#task done\n调研结论：市场增长 12%' } }]],
      logger: { info: vi.fn() },
    });

    const task = await repo.getTask(dispatched.task.id);
    expect(task?.status).toBe('completed');
    expect(task?.result_summary).toContain('调研结论');
  });
});
