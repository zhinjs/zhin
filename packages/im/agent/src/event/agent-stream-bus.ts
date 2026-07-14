/**
 * AgentStreamBus — single egress for Eve-aligned wire events (ADR 0041).
 */
import type { AgentStreamEvent } from '@zhin.js/ai/agent-stream';

export interface AgentStreamPublishContext {
  sessionId?: string;
  httpSessionId?: string;
  turnId?: string;
  agentId?: string;
}

export interface AgentStreamSink {
  readonly name: string;
  handle(event: AgentStreamEvent, ctx: AgentStreamPublishContext): void | Promise<void>;
}

export interface AgentStreamBus {
  registerSink(sink: AgentStreamSink): () => void;
  publish(event: AgentStreamEvent, ctx?: AgentStreamPublishContext): Promise<void>;
}

export class DefaultAgentStreamBus implements AgentStreamBus {
  private readonly sinks: AgentStreamSink[] = [];

  registerSink(sink: AgentStreamSink): () => void {
    this.sinks.push(sink);
    return () => {
      const idx = this.sinks.indexOf(sink);
      if (idx !== -1) this.sinks.splice(idx, 1);
    };
  }

  async publish(event: AgentStreamEvent, ctx: AgentStreamPublishContext = {}): Promise<void> {
    const stamped: AgentStreamEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };
    await Promise.all(this.sinks.map((sink) => sink.handle(stamped, ctx)));
  }
}

export function createAgentStreamBus(): DefaultAgentStreamBus {
  return new DefaultAgentStreamBus();
}
