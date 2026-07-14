import { vi } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import type { Message } from '@zhin.js/core';
import { AgentOrchestrator } from '../../src/orchestrator/index.js';
import { mapTurnEventToAgentStreamEvents } from '../../src/event/turn-to-agent-stream.js';
import { createAgentSessionHostPort, type AgentSessionHostPort } from '../../src/session/agent-session-host-port.js';
import type { ZhinAgent } from '../../src/zhin-agent/index.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

export function mockAgent(events: TurnEvent[]): ZhinAgent {
  return {
    processStream: vi.fn(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
  } as unknown as ZhinAgent;
}

/** Wraps a mock agent so turn events publish to the shared AgentStreamBus (sink-driven log). */
export function createTestSessionPort(
  agent: ZhinAgent,
  options?: { dataDir?: string },
): AgentSessionHostPort {
  const orchestrator = new AgentOrchestrator();
  const bus = orchestrator.agentStreamBus;

  const wrappedAgent = {
    processStream: vi.fn(async function* (message: string, commMessage?: Message) {
      const sessionId = typeof commMessage?.$channel?.id === 'string'
        ? commMessage.$channel.id
        : 's';
      const turnId = 't';
      await bus.publish({
        type: AgentStreamEventType.MESSAGE_RECEIVED,
        data: { message },
      }, { sessionId, httpSessionId: sessionId, turnId });
      const inner = agent.processStream(message, commMessage);
      for await (const event of inner) {
        for (const streamEvent of mapTurnEventToAgentStreamEvents(event, { sessionId, turnId })) {
          await bus.publish(streamEvent, { sessionId, httpSessionId: sessionId, turnId });
        }
        yield event;
      }
    }),
  } as unknown as ZhinAgent;

  return createAgentSessionHostPort({
    getAgent: () => wrappedAgent,
    bus,
    dataDir: options?.dataDir,
  });
}
