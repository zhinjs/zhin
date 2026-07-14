import { describe, expect, it } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { AgentStepStatus } from '@zhin.js/ai/agent-step-checkpoint';
import { HttpStepProjector } from '../../src/session/http-step-projector.js';

describe('HttpStepProjector', () => {
  it('emits step lifecycle for a completed turn', () => {
    const projector = new HttpStepProjector();
    const started = projector.onStreamEvent({
      type: AgentStreamEventType.TURN_STARTED,
      data: { turnId: 't1' },
    });
    expect(started).toHaveLength(1);
    expect(started[0].type).toBe(AgentStreamEventType.STEP_STARTED);

    expect(projector.onStreamEvent({
      type: AgentStreamEventType.MESSAGE_APPENDED,
      data: { messageDelta: 'hi' },
    })).toHaveLength(0);

    const completed = projector.onStreamEvent({
      type: AgentStreamEventType.TURN_COMPLETED,
      data: { turnId: 't1' },
    });
    expect(completed).toHaveLength(1);
    expect(completed[0].type).toBe(AgentStreamEventType.STEP_COMPLETED);
    expect(projector.getSteps()).toHaveLength(1);
    expect(projector.getSteps()[0].status).toBe(AgentStepStatus.COMPLETED);
    expect(projector.isParked()).toBe(false);
  });

  it('marks step interrupted on input.requested', () => {
    const projector = new HttpStepProjector();
    projector.onStreamEvent({ type: AgentStreamEventType.TURN_STARTED, data: { turnId: 't2' } });
    const interrupted = projector.onStreamEvent({
      type: AgentStreamEventType.INPUT_REQUESTED,
      data: { requestId: 'req-1', kind: 'approval' },
    });
    expect(interrupted[0].type).toBe(AgentStreamEventType.STEP_INTERRUPTED);
    expect(projector.pendingRequestIds()).toEqual(['req-1']);
    expect(projector.isParked()).toBe(true);
  });

  it('restores steps from snapshot', () => {
    const projector = new HttpStepProjector();
    projector.restoreSteps([
      {
        stepId: 'stp_a',
        status: AgentStepStatus.INTERRUPTED,
        startedAt: 1,
        requestId: 'req-x',
        interruptKind: 'approval',
      },
    ]);
    expect(projector.pendingRequestIds()).toEqual(['req-x']);
    expect(projector.isParked()).toBe(true);
  });
});
