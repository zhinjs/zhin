/**
 * HTTP turn runner — processStream without duplicate TurnEvent mapping (ADR 0041).
 */
import { createSyntheticMessage } from '@zhin.js/core';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import type { AgentStreamBus } from '../event/agent-stream-bus.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { ParkController, HttpSessionParkState } from './park-controller.js';

export interface HttpTurnRunnerDeps {
  getAgent: () => ZhinAgent | null;
  bus: AgentStreamBus;
  park: ParkController;
  sessions: Map<string, HttpSessionParkState>;
  onPersist?: (sessionId: string) => void;
}

export class HttpTurnRunner {
  constructor(private readonly deps: HttpTurnRunnerDeps) {}

  async run(sessionId: string, message: string): Promise<void> {
    const state = this.deps.sessions.get(sessionId);
    if (!state) return;

    const agent = this.deps.getAgent();
    if (!agent) {
      state.status = 'failed';
      await this.deps.bus.publish({
        type: AgentStreamEventType.SESSION_FAILED,
        data: { code: 'AGENT_UNAVAILABLE', message: 'ZhinAgent runtime 未就绪' },
      }, { sessionId, httpSessionId: sessionId });
      return;
    }

    state.turnRunning = true;

    const commMessage = createSyntheticMessage({
      adapter: 'host',
      endpoint: 'zhin-v1',
      sender: { id: 'http-client', isMaster: true },
      channel: { type: 'private', id: sessionId },
      extra: { httpSessionId: sessionId },
    });

    try {
      for await (const _turnEvent of agent.processStream(message, commMessage)) {
        /* wire events arrive via HttpSessionSink */
      }
      state.status = 'waiting';
      this.deps.park.emitSessionWaiting(state, state.parked ? 'parked' : 'idle');
    } catch (err) {
      state.status = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      await this.deps.bus.publish({
        type: AgentStreamEventType.TURN_FAILED,
        data: { code: 'TURN_ERROR', message: msg },
      }, { sessionId, httpSessionId: sessionId });
      await this.deps.bus.publish({
        type: AgentStreamEventType.SESSION_FAILED,
        data: { code: 'TURN_ERROR', message: msg },
      }, { sessionId, httpSessionId: sessionId });
    } finally {
      state.turnRunning = false;
      this.deps.onPersist?.(sessionId);
    }
  }
}
