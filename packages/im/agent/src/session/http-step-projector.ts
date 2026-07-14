/**
 * Projects turn-scoped steps from AgentStream events (ADR 0040 P3 / ADR 0041).
 */
import { AgentStreamEventType, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import {
  AgentStepStatus,
  createStepId,
  type AgentStepCheckpoint,
  type AgentStepInterruptKind,
} from '@zhin.js/ai/agent-step-checkpoint';

function interruptKindFromEvent(event: AgentStreamEvent): AgentStepInterruptKind {
  if (event.type === AgentStreamEventType.INPUT_REQUESTED) return 'approval';
  if (event.type === AgentStreamEventType.AUTHORIZATION_REQUIRED) return 'authorization';
  return 'unknown';
}

export class HttpStepProjector {
  private steps: AgentStepCheckpoint[] = [];
  private current: AgentStepCheckpoint | null = null;

  getSteps(): AgentStepCheckpoint[] {
    return [...this.steps];
  }

  restoreSteps(steps: AgentStepCheckpoint[]): void {
    this.steps = [...steps];
    this.current = null;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].status === AgentStepStatus.RUNNING) {
        this.current = { ...this.steps[i] };
        break;
      }
    }
  }

  /** Returns extra step wire events to append after the triggering event. */
  onStreamEvent(event: AgentStreamEvent): AgentStreamEvent[] {
    const extras: AgentStreamEvent[] = [];
    const ts = event.timestamp ?? Date.now();

    if (event.type === AgentStreamEventType.TURN_STARTED) {
      const turnId = typeof event.data?.turnId === 'string' ? event.data.turnId : undefined;
      const step: AgentStepCheckpoint = {
        stepId: createStepId(),
        turnId,
        status: AgentStepStatus.RUNNING,
        startedAt: ts,
      };
      this.current = step;
      this.steps.push(step);
      extras.push({
        type: AgentStreamEventType.STEP_STARTED,
        timestamp: ts,
        data: { stepId: step.stepId, turnId, status: step.status },
      });
      return extras;
    }

    if (!this.current) return extras;

    if (
      event.type === AgentStreamEventType.INPUT_REQUESTED
      || event.type === AgentStreamEventType.AUTHORIZATION_REQUIRED
    ) {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : undefined;
      this.current.status = AgentStepStatus.INTERRUPTED;
      this.current.interruptKind = interruptKindFromEvent(event);
      this.current.requestId = requestId;
      extras.push({
        type: AgentStreamEventType.STEP_INTERRUPTED,
        timestamp: ts,
        data: {
          stepId: this.current.stepId,
          turnId: this.current.turnId,
          status: this.current.status,
          interruptKind: this.current.interruptKind,
          requestId,
        },
      });
      return extras;
    }

    if (event.type === AgentStreamEventType.TURN_COMPLETED) {
      this.current.status = AgentStepStatus.COMPLETED;
      this.current.completedAt = ts;
      extras.push({
        type: AgentStreamEventType.STEP_COMPLETED,
        timestamp: ts,
        data: {
          stepId: this.current.stepId,
          turnId: this.current.turnId,
          status: this.current.status,
        },
      });
      this.current = null;
      return extras;
    }

    if (event.type === AgentStreamEventType.TURN_FAILED) {
      this.current.status = AgentStepStatus.INTERRUPTED;
      this.current.completedAt = ts;
      extras.push({
        type: AgentStreamEventType.STEP_INTERRUPTED,
        timestamp: ts,
        data: {
          stepId: this.current.stepId,
          turnId: this.current.turnId,
          status: this.current.status,
          interruptKind: 'unknown',
        },
      });
      this.current = null;
      return extras;
    }

    return extras;
  }

  pendingRequestIds(): string[] {
    const ids = new Set<string>();
    for (const step of this.steps) {
      if (step.status === AgentStepStatus.INTERRUPTED && step.requestId) {
        ids.add(step.requestId);
      }
    }
    return [...ids];
  }

  isParked(): boolean {
    return this.pendingRequestIds().length > 0
      || (this.current?.status === AgentStepStatus.INTERRUPTED);
  }
}
