import { describe, expect, it } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createAgentStreamBus } from '../../src/event/agent-stream-bus.js';
import { SessionEventLog } from '../../src/session/session-event-log.js';
import { ParkController, type HttpSessionParkState } from '../../src/session/park-controller.js';
import { HttpStepProjector } from '../../src/session/http-step-projector.js';
import { createHttpSessionSink } from '../../src/session/http-session-sink.js';

describe('createHttpSessionSink', () => {
  it('no-ops when httpSessionId is absent', async () => {
    const bus = createAgentStreamBus();
    const log = new SessionEventLog();
    const park = new ParkController(bus);
    const sessions = new Map<string, HttpSessionParkState>();

    bus.registerSink(createHttpSessionSink({ sessions, log, park }));

    await bus.publish({
      type: AgentStreamEventType.MESSAGE_RECEIVED,
      data: { message: 'hi' },
    }, { sessionId: 'ses_1' });

    expect(log.getEvents('ses_1')).toHaveLength(0);
  });

  it('appends events and projects steps when httpSessionId is set', async () => {
    const bus = createAgentStreamBus();
    const log = new SessionEventLog();
    const park = new ParkController(bus);
    const sessions = new Map<string, HttpSessionParkState>();
    const sessionId = 'ses_test';
    sessions.set(sessionId, {
      sessionId,
      continuationToken: 'zhin:tok',
      status: 'running',
      parked: false,
      pendingRequestIds: [],
      turnRunning: true,
      stepProjector: new HttpStepProjector(),
    });

    bus.registerSink(createHttpSessionSink({ sessions, log, park }));

    await bus.publish({
      type: AgentStreamEventType.TURN_STARTED,
      data: { sessionId, turnId: 't1' },
    }, { sessionId, httpSessionId: sessionId, turnId: 't1' });

    await bus.publish({
      type: AgentStreamEventType.TURN_COMPLETED,
      data: { sessionId, turnId: 't1' },
    }, { sessionId, httpSessionId: sessionId, turnId: 't1' });

    const events = log.getEvents(sessionId);
    expect(events.some((e) => e.type === AgentStreamEventType.TURN_STARTED)).toBe(true);
    expect(events.some((e) => e.type === AgentStreamEventType.STEP_STARTED)).toBe(true);
    expect(events.some((e) => e.type === AgentStreamEventType.STEP_COMPLETED)).toBe(true);
  });
});
