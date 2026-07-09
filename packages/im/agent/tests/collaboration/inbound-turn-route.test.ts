/**
 * inbound-turn-route 单测 — Kernel 委派 early return（阶段 4）。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { routeInboundTurnExecution } from '../../src/collaboration/inbound-turn-route.js';
import type { TurnPlan } from '../../src/collaboration/types.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

vi.mock('../../src/collaboration/collaboration-dispatch.js', () => ({
  dispatchPeerTask: vi.fn(),
}));

import { dispatchPeerTask } from '../../src/collaboration/collaboration-dispatch.js';

describe('routeInboundTurnExecution', () => {
  afterEach(() => {
    vi.mocked(dispatchPeerTask).mockReset();
  });

  it('returns done when kernel internal_room dispatch succeeds', async () => {
    vi.mocked(dispatchPeerTask).mockResolvedValue({
      runId: 'run-1',
      taskId: 'task-1',
      task: { id: 'task-1', status: 'waiting_result' } as any,
    });

    const process = vi.fn();
    const message = mockCommMessage({ adapter: 'icqq', endpoint: 'e1', scope: 'group', sceneId: 's1' });
    const turnPlan: TurnPlan = {
      inboundEndpointId: 'e1',
      handlerProfile: 'planner',
      outboundEndpointId: 'e1',
      sessionKeys: { transport: 'sk' },
      delegation: {
        mode: 'local_process',
        delegateToPeer: 'e2',
        targetEndpointId: 'e2',
      },
    };
    const cell = {
      id: 'cell-1',
      adapter: 'icqq',
      sceneId: 's1',
      goal: 'g',
      members: [
        { endpointId: 'e1', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: 'e2', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    };

    const result = await routeInboundTurnExecution({
      root: { inject: () => undefined } as any,
      ai: { getResidentToolsAsTools: () => [] } as any,
      zhinAgent: {
        initInboundTurnContext: vi.fn(),
        process,
        processMultimodal: vi.fn(),
        configure: vi.fn(),
      } as any,
      commMessage: message as any,
      message,
      aiContent: 'delegate please',
      turnPlan,
      cell,
      endpointId: 'e1',
      refs: {} as any,
      mediaParts: [],
      replyAi: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toEqual({ kind: 'done' });
    expect(process).not.toHaveBeenCalled();
    expect(dispatchPeerTask).toHaveBeenCalledWith(expect.objectContaining({
      fromEndpointId: 'e1',
      toEndpointId: 'e2',
    }));
  });
});
