import { describe, expect, it } from 'vitest';
import {
  AgentStreamEventType,
  createAgentStreamNdjsonParserState,
  flushAgentStreamNdjsonParser,
  foldAgentStreamNdjson,
  parseAgentStreamNdjsonChunk,
  createAgentStreamReduceState,
  reduceAgentStreamEvent,
} from '../src/agent-stream.js';

describe('agent-stream consumer', () => {
  it('parseAgentStreamNdjsonChunk handles split lines across chunks', () => {
    let state = createAgentStreamNdjsonParserState();
    const first = parseAgentStreamNdjsonChunk(
      '{"type":"session.started","data":{"sessionId":"s1"}}\n{"type":"turn.',
      state,
    );
    state = first.state;
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.type).toBe(AgentStreamEventType.SESSION_STARTED);

    const second = parseAgentStreamNdjsonChunk('started"}\n', state);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.type).toBe(AgentStreamEventType.TURN_STARTED);
  });

  it('flushAgentStreamNdjsonParser parses trailing line', () => {
    const state = { remainder: '{"type":"session.waiting","data":{}}' };
    const { events } = flushAgentStreamNdjsonParser(state);
    expect(events[0]?.type).toBe(AgentStreamEventType.SESSION_WAITING);
  });

  it('foldAgentStreamNdjson reduces assistant text', async () => {
    async function* body() {
      yield '{"type":"message.appended","data":{"messageDelta":"Hi","message":"Hi"}}\n';
      yield '{"type":"session.waiting","data":{"continuationToken":"zhin:1"}}\n';
    }
    const state = await foldAgentStreamNdjson(body());
    expect(state.assistantText).toBe('Hi');
    expect(state.waiting).toBe(true);
  });

  it('reduceAgentStreamEvent tracks input.requested / authorization.required', () => {
    let state = createAgentStreamReduceState();
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.INPUT_REQUESTED,
      data: { requestId: 'r1', kind: 'approval', toolName: 'bash' },
    });
    expect(state.pendingInputs).toHaveLength(1);
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.INPUT_COMPLETED,
      data: { requestId: 'r1', kind: 'approval', approved: true },
    });
    expect(state.pendingInputs).toHaveLength(0);

    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.AUTHORIZATION_REQUIRED,
      data: { requestId: 'a1', connection: 'linear', authUrl: 'https://x' },
    });
    expect(state.pendingAuthorizations[0]?.connection).toBe('linear');
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.AUTHORIZATION_COMPLETED,
      data: { requestId: 'a1', connection: 'linear', success: true },
    });
    expect(state.pendingAuthorizations).toHaveLength(0);
  });
});
