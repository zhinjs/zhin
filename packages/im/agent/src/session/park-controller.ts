/**
 * Park / waiting semantics for HTTP sessions (ADR 0040 P3 / ADR 0041).
 */
import { randomUUID } from 'node:crypto';
import { AgentStreamEventType, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { AgentStepCheckpoint } from '@zhin.js/ai/agent-step-checkpoint';
import type { AgentStreamBus } from '../event/agent-stream-bus.js';
import type { HttpStepProjector } from './http-step-projector.js';

export interface HttpSessionParkState {
  sessionId: string;
  continuationToken: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  parked: boolean;
  pendingRequestIds: string[];
  turnRunning: boolean;
  stepProjector: HttpStepProjector;
}

export class ParkController {
  constructor(private readonly bus: AgentStreamBus) {}

  newContinuationToken(): string {
    return `zhin:${randomUUID()}`;
  }

  syncPendingFromEvent(state: HttpSessionParkState, event: AgentStreamEvent): void {
    const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : '';
    if (!requestId) return;

    if (
      event.type === AgentStreamEventType.INPUT_REQUESTED
      || event.type === AgentStreamEventType.AUTHORIZATION_REQUIRED
    ) {
      if (!state.pendingRequestIds.includes(requestId)) {
        state.pendingRequestIds = [...state.pendingRequestIds, requestId];
      }
      return;
    }

    if (
      event.type === AgentStreamEventType.INPUT_COMPLETED
      || event.type === AgentStreamEventType.AUTHORIZATION_COMPLETED
    ) {
      state.pendingRequestIds = state.pendingRequestIds.filter((id) => id !== requestId);
    }
  }

  refreshParked(state: HttpSessionParkState): void {
    state.parked = state.pendingRequestIds.length > 0 || state.stepProjector.isParked();
  }

  shouldEmitMidTurnPark(state: HttpSessionParkState, event: AgentStreamEvent): boolean {
    return state.turnRunning
      && state.parked
      && (
        event.type === AgentStreamEventType.INPUT_REQUESTED
        || event.type === AgentStreamEventType.AUTHORIZATION_REQUIRED
      );
  }

  emitSessionWaiting(state: HttpSessionParkState, reason: 'idle' | 'parked'): void {
    state.status = 'waiting';
    state.continuationToken = this.newContinuationToken();
    void this.bus.publish({
      type: AgentStreamEventType.SESSION_WAITING,
      data: {
        sessionId: state.sessionId,
        continuationToken: state.continuationToken,
        parked: reason === 'parked',
        reason,
        pendingRequestIds: state.pendingRequestIds,
        steps: state.stepProjector.getSteps(),
      },
    }, { sessionId: state.sessionId, httpSessionId: state.sessionId });
  }

  getSteps(state: HttpSessionParkState): AgentStepCheckpoint[] {
    return state.stepProjector.getSteps();
  }
}
