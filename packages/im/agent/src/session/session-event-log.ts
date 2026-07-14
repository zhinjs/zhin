/**
 * Append-only HTTP session event log (ADR 0041).
 */
import type { AgentStreamEvent } from '@zhin.js/ai/agent-stream';

export type SessionEventListener = (event: AgentStreamEvent, index: number) => void;

export class SessionEventLog {
  private readonly events = new Map<string, AgentStreamEvent[]>();
  private readonly listeners = new Map<string, Set<SessionEventListener>>();

  getEvents(sessionId: string): AgentStreamEvent[] {
    return this.events.get(sessionId) ?? [];
  }

  append(sessionId: string, event: AgentStreamEvent): number {
    const stamped: AgentStreamEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };
    let list = this.events.get(sessionId);
    if (!list) {
      list = [];
      this.events.set(sessionId, list);
    }
    list.push(stamped);
    const index = list.length - 1;
    this.notify(sessionId, stamped, index);
    return index;
  }

  slice(sessionId: string, startIndex: number): AgentStreamEvent[] {
    const list = this.events.get(sessionId) ?? [];
    const from = Math.max(0, Math.floor(startIndex));
    return list.slice(from);
  }

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(sessionId);
    };
  }

  replaceEvents(sessionId: string, events: AgentStreamEvent[]): void {
    this.events.set(sessionId, [...events]);
  }

  deleteSession(sessionId: string): void {
    this.events.delete(sessionId);
    this.listeners.delete(sessionId);
  }

  private notify(sessionId: string, event: AgentStreamEvent, index: number): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) {
      listener(event, index);
    }
  }
}
