/**
 * HTTP agent session facade — continuationToken + NDJSON log (ADR 0039 P0 / ADR 0041).
 */
import { randomUUID } from 'node:crypto';
import { AgentStreamEventType, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { AgentStepCheckpoint } from '@zhin.js/ai/agent-step-checkpoint';
import type { AgentStreamBus } from '../event/agent-stream-bus.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import { HttpStepProjector } from './http-step-projector.js';
import type { HttpApprovalAdapter } from './http-approval-adapter.js';
import type { ParkController, HttpSessionParkState } from './park-controller.js';
import type { SessionEventLog } from './session-event-log.js';
import type { HttpSessionPersistence, PersistedHttpSessionSnapshot } from './http-session-persistence.js';
import type { HttpTurnRunner } from './http-turn-runner.js';

export type HttpAgentSessionStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface HttpAgentSessionRecord {
  sessionId: string;
  continuationToken: string;
  status: HttpAgentSessionStatus;
  events: AgentStreamEvent[];
  steps: AgentStepCheckpoint[];
  parked: boolean;
  pendingRequestIds: string[];
  turnRunning: boolean;
}

export interface HttpAgentSessionStoreOptions {
  getAgent: () => ZhinAgent | null;
  maxSessions?: number;
  log: SessionEventLog;
  park: ParkController;
  httpApprovalAdapter: HttpApprovalAdapter;
  persistence?: HttpSessionPersistence;
  onPersist?: (sessionId: string) => void;
}

export class HttpAgentSessionStore {
  private readonly sessions = new Map<string, HttpSessionParkState>();
  private readonly getAgent: () => ZhinAgent | null;
  private readonly maxSessions: number;
  private readonly log: SessionEventLog;
  private readonly park: ParkController;
  private readonly httpApprovalAdapter: HttpApprovalAdapter;
  private readonly persistence?: HttpSessionPersistence;
  private readonly onPersist?: (sessionId: string) => void;
  private turnRunner?: HttpTurnRunner;
  private bus?: AgentStreamBus;

  constructor(options: HttpAgentSessionStoreOptions) {
    this.getAgent = options.getAgent;
    this.maxSessions = options.maxSessions ?? 500;
    this.log = options.log;
    this.park = options.park;
    this.httpApprovalAdapter = options.httpApprovalAdapter;
    this.persistence = options.persistence;
    this.onPersist = options.onPersist;
  }

  setTurnRunner(runner: HttpTurnRunner): void {
    this.turnRunner = runner;
  }

  setBus(bus: AgentStreamBus): void {
    this.bus = bus;
  }

  getSessionsMap(): Map<string, HttpSessionParkState> {
    return this.sessions;
  }

  getSession(sessionId: string): HttpAgentSessionRecord | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return this.toRecord(state);
  }

  async hydrateSession(sessionId: string): Promise<HttpAgentSessionRecord | undefined> {
    const existing = this.sessions.get(sessionId);
    if (existing) return this.toRecord(existing);
    if (!this.persistence) return undefined;
    const snapshot = await this.persistence.load(sessionId);
    if (!snapshot) return undefined;
    return this.ingestSnapshot(snapshot);
  }

  async restoreFromDisk(): Promise<number> {
    if (!this.persistence) return 0;
    const ids = await this.persistence.listSessionIds();
    let n = 0;
    for (const sessionId of ids) {
      if (this.sessions.has(sessionId)) continue;
      const snapshot = await this.persistence.load(sessionId);
      if (snapshot) {
        this.ingestSnapshot(snapshot);
        n++;
      }
    }
    return n;
  }

  listEventSlice(sessionId: string, startIndex: number): AgentStreamEvent[] {
    return this.log.slice(sessionId, startIndex);
  }

  subscribe(sessionId: string, listener: (event: AgentStreamEvent, index: number) => void): () => void {
    return this.log.subscribe(sessionId, listener);
  }

  async startSession(message: string): Promise<{ sessionId: string; continuationToken: string }> {
    this.evictIfNeeded();
    const sessionId = `ses_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const continuationToken = this.park.newContinuationToken();
    const state = this.createState(sessionId, continuationToken);
    this.sessions.set(sessionId, state);

    const bus = this.requireBus();
    await bus.publish({
      type: AgentStreamEventType.SESSION_STARTED,
      data: { sessionId },
    }, { sessionId, httpSessionId: sessionId });

    void this.turnRunner?.run(sessionId, message);
    return { sessionId, continuationToken };
  }

  async continueSession(
    sessionId: string,
    continuationToken: string,
    message: string,
  ): Promise<{ ok: true; continuationToken: string } | { ok: false; error: string }> {
    const state = this.sessions.get(sessionId) ?? await this.hydrateState(sessionId);
    if (!state) {
      return { ok: false, error: 'SESSION_NOT_FOUND' };
    }
    if (state.continuationToken !== continuationToken) {
      return { ok: false, error: 'CONTINUATION_TOKEN_STALE' };
    }
    if (state.turnRunning) {
      return { ok: false, error: 'SESSION_BUSY' };
    }
    if (state.status === 'completed' || state.status === 'failed') {
      return { ok: false, error: 'SESSION_TERMINAL' };
    }
    state.status = 'running';
    state.parked = false;
    await this.turnRunner?.run(sessionId, message);
    const updated = this.sessions.get(sessionId);
    if (!updated || updated.status === 'failed') {
      return { ok: false, error: 'SESSION_FAILED' };
    }
    return { ok: true, continuationToken: updated.continuationToken };
  }

  async submitInput(
    sessionId: string,
    requestId: string,
    approved: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const state = this.sessions.get(sessionId) ?? await this.hydrateState(sessionId);
    if (!state) {
      return { ok: false, error: 'SESSION_NOT_FOUND' };
    }
    const resolved = this.httpApprovalAdapter.resolveApproval(requestId, approved);
    if (!resolved) {
      return { ok: false, error: 'REQUEST_NOT_FOUND' };
    }
    state.pendingRequestIds = state.pendingRequestIds.filter((id) => id !== requestId);
    this.park.refreshParked(state);
    this.onPersist?.(sessionId);
    return { ok: true };
  }

  async persistSession(sessionId: string): Promise<void> {
    if (!this.persistence) return;
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const snapshot: PersistedHttpSessionSnapshot = {
      sessionId: state.sessionId,
      continuationToken: state.continuationToken,
      status: state.status,
      events: this.log.getEvents(sessionId),
      steps: state.stepProjector.getSteps(),
      parked: state.parked,
      pendingRequestIds: state.pendingRequestIds,
      turnRunning: false,
      updatedAt: Date.now(),
    };
    await this.persistence.save(snapshot);
  }

  dispose(): void {
    this.sessions.clear();
  }

  private requireBus(): AgentStreamBus {
    if (!this.bus) {
      throw new Error('HttpAgentSessionStore: AgentStreamBus not wired');
    }
    return this.bus;
  }

  private createState(sessionId: string, continuationToken: string): HttpSessionParkState {
    return {
      sessionId,
      continuationToken,
      status: 'running',
      parked: false,
      pendingRequestIds: [],
      turnRunning: false,
      stepProjector: new HttpStepProjector(),
    };
  }

  private ingestSnapshot(snapshot: PersistedHttpSessionSnapshot): HttpAgentSessionRecord {
    const projector = new HttpStepProjector();
    projector.restoreSteps(snapshot.steps);
    const state: HttpSessionParkState = {
      sessionId: snapshot.sessionId,
      continuationToken: snapshot.continuationToken,
      status: snapshot.status,
      parked: snapshot.parked,
      pendingRequestIds: [...snapshot.pendingRequestIds],
      turnRunning: false,
      stepProjector: projector,
    };
    this.sessions.set(snapshot.sessionId, state);
    this.log.replaceEvents(snapshot.sessionId, [...snapshot.events]);
    return this.toRecord(state);
  }

  private async hydrateState(sessionId: string): Promise<HttpSessionParkState | undefined> {
    const record = await this.hydrateSession(sessionId);
    if (!record) return undefined;
    return this.sessions.get(sessionId);
  }

  private toRecord(state: HttpSessionParkState): HttpAgentSessionRecord {
    return {
      sessionId: state.sessionId,
      continuationToken: state.continuationToken,
      status: state.status,
      events: this.log.getEvents(state.sessionId),
      steps: state.stepProjector.getSteps(),
      parked: state.parked,
      pendingRequestIds: [...state.pendingRequestIds],
      turnRunning: state.turnRunning,
    };
  }

  private evictIfNeeded(): void {
    if (this.sessions.size <= this.maxSessions) return;
    const sorted = [...this.sessions.entries()].sort(
      (a, b) => (this.log.getEvents(a[0])[0]?.timestamp ?? 0) - (this.log.getEvents(b[0])[0]?.timestamp ?? 0),
    );
    const excess = this.sessions.size - Math.floor(this.maxSessions * 0.8);
    for (let i = 0; i < excess && i < sorted.length; i++) {
      const id = sorted[i][0];
      this.sessions.delete(id);
      this.log.deleteSession(id);
    }
  }
}
