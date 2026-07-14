/**
 * AgentSessionHostPort — Host `/zhin/v1/session*` bootstrap seam (ADR 0041).
 */
import type { AgentStreamBus } from '../event/agent-stream-bus.js';
import type { AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import { HttpApprovalAdapter } from './http-approval-adapter.js';
import { HttpAgentSessionStore } from './http-agent-session-store.js';
import { SessionEventLog } from './session-event-log.js';
import { ParkController } from './park-controller.js';
import { HttpTurnRunner } from './http-turn-runner.js';
import { createHttpSessionSink } from './http-session-sink.js';
import { FileHttpSessionPersistence, type HttpSessionPersistence } from './http-session-persistence.js';
import type { ZhinAgent } from '../zhin-agent/index.js';

export interface AgentSessionHostPort {
  store: HttpAgentSessionStore;
  httpApprovalAdapter: HttpApprovalAdapter;
  bus: AgentStreamBus;
  publishHttpSessionEvent(sessionId: string, event: AgentStreamEvent): Promise<void>;
  dispose(): void;
}

export interface CreateAgentSessionHostPortOptions {
  getAgent: () => ZhinAgent | null;
  bus: AgentStreamBus;
  dataDir?: string;
  maxSessions?: number;
}

export function createAgentSessionHostPort(
  options: CreateAgentSessionHostPortOptions,
): AgentSessionHostPort {
  const log = new SessionEventLog();
  const park = new ParkController(options.bus);
  const httpApprovalAdapter = new HttpApprovalAdapter();
  const persistence: HttpSessionPersistence | undefined = options.dataDir
    ? new FileHttpSessionPersistence(options.dataDir)
    : undefined;

  const storeRef: { current: HttpAgentSessionStore | null } = { current: null };
  const onPersist = persistence
    ? (sessionId: string) => { void storeRef.current?.persistSession(sessionId); }
    : undefined;

  const store = new HttpAgentSessionStore({
    getAgent: options.getAgent,
    maxSessions: options.maxSessions,
    log,
    park,
    httpApprovalAdapter,
    persistence,
    onPersist,
  });
  storeRef.current = store;
  store.setBus(options.bus);

  const sinkOff = options.bus.registerSink(createHttpSessionSink({
    sessions: store.getSessionsMap(),
    log,
    park,
    onPersist,
  }));

  const turnRunner = new HttpTurnRunner({
    getAgent: options.getAgent,
    bus: options.bus,
    park,
    sessions: store.getSessionsMap(),
    onPersist,
  });
  store.setTurnRunner(turnRunner);

  if (persistence) {
    void store.restoreFromDisk();
  }

  return {
    store,
    httpApprovalAdapter,
    bus: options.bus,
    publishHttpSessionEvent(sessionId, event) {
      return options.bus.publish(event, { sessionId, httpSessionId: sessionId });
    },
    dispose() {
      sinkOff();
      httpApprovalAdapter.waiter.dispose();
      store.dispose();
    },
  };
}
