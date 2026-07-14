/**
 * HttpSessionSink — bus adapter writing HTTP session event log (ADR 0041).
 */
import { AgentStreamEventType, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { AgentStreamPublishContext, AgentStreamSink } from '../event/agent-stream-bus.js';
import type { ParkController, HttpSessionParkState } from './park-controller.js';
import type { SessionEventLog } from './session-event-log.js';

export interface HttpSessionSinkDeps {
  sessions: Map<string, HttpSessionParkState>;
  log: SessionEventLog;
  park: ParkController;
  onPersist?: (sessionId: string) => void;
}

export function createHttpSessionSink(deps: HttpSessionSinkDeps): AgentStreamSink {
  const ingest = (sessionId: string, event: AgentStreamEvent, skipMidTurnPark = false): void => {
    const state = deps.sessions.get(sessionId);
    if (!state) return;

    deps.log.append(sessionId, event);

    for (const stepEvent of state.stepProjector.onStreamEvent(event)) {
      deps.log.append(sessionId, stepEvent);
    }

    deps.park.syncPendingFromEvent(state, event);
    deps.park.refreshParked(state);

    if (!skipMidTurnPark && deps.park.shouldEmitMidTurnPark(state, event)) {
      deps.park.emitSessionWaiting(state, 'parked');
    }

    deps.onPersist?.(sessionId);
  };

  return {
    name: 'http-session',
    handle(event, ctx: AgentStreamPublishContext) {
      const sessionId = ctx.httpSessionId;
      if (!sessionId) return;
      const skipMidTurnPark = event.type === AgentStreamEventType.SESSION_WAITING;
      ingest(sessionId, event, skipMidTurnPark);
    },
  };
}
