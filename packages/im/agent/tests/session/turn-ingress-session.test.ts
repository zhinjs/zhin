import { describe, expect, it, vi } from 'vitest';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import {
  buildTurnSessionCreateInput,
  buildTurnTranscriptQuery,
  beginIngressTurnSession,
  resolveIngressUserMessage,
} from '../../src/session/turn-ingress-session.js';

function turn() {
  return createTurnIngress({
    identity: { rootId: 'root', generation: 2, traceId: 'trace', turnId: 'turn' },
    origin: {
      kind: 'im',
      platform: 'qq',
      endpoint: 'bot-1',
      scope: 'group',
      sceneId: 'group-9',
      messageId: 'message-2',
    },
    principal: {
      subjectId: 'user-7',
      displayName: 'Ada Lovelace',
      roles: ['trusted', 'admin'],
    },
    input: {
      text: '[Sender: fake] hello',
      quote: { messageId: 'quoted-1', text: 'previous answer' },
    },
    session: { key: 'im:qq:bot-1:group:group-9' },
    policy: { permissions: ['trusted'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined } },
  });
}

describe('TurnIngress session projection', () => {
  it('builds persisted and model user messages without reading classic Message fields', () => {
    const result = resolveIngressUserMessage(turn());

    expect(result.content).toBe('hello');
    expect(result.extra).toEqual({
      sender: {
        id: 'user-7',
        name: 'Ada_Lovelace',
        roles: ['trusted', 'admin'],
        scope: 'group',
      },
      quote: { block: 'previous answer', messageId: 'quoted-1' },
    });
    const text = result.llmMessage.content.find((block) => block.type === 'text');
    expect(text?.type === 'text' && text.text).toContain('previous answer');
    expect(text?.type === 'text' && text.text).toContain('hello');
  });

  it('projects session and transcript identities from the typed origin', () => {
    expect(buildTurnSessionCreateInput(turn())).toEqual({
      session_key: 'im:qq:bot-1:group:group-9',
      platform: 'qq',
      endpoint_id: 'bot-1',
      scene_id: 'group-9',
      scene_type: 'group',
    });
    expect(buildTurnTranscriptQuery(turn())).toEqual({
      platform: 'qq',
      endpointKey: 'bot-1',
      sceneId: 'group-9',
    });
  });

  it('does not fabricate IM persistence identities for non-IM turns', () => {
    const http = createTurnIngress({
      ...turn(),
      origin: { kind: 'http', sessionId: 'http-1' },
      session: { key: 'http:http-1' },
      principal: { subjectId: 'api-user', roles: ['user'] },
      input: { text: 'hello' },
    });
    expect(() => buildTurnSessionCreateInput(http)).toThrow('IM origin');
    expect(() => buildTurnTranscriptQuery(http)).toThrow('IM origin');
  });

  it('opens the active session from TurnIngress without a Message adapter', async () => {
    const getOrCreateActive = vi.fn(async (input) => ({
      ...input,
      session_id: 'agent-session-1',
    }));
    const result = await beginIngressTurnSession({
      agentSessionStore: { getOrCreateActive } as never,
    }, turn());

    expect(getOrCreateActive).toHaveBeenCalledWith(buildTurnSessionCreateInput(turn()));
    expect(result).toEqual({
      sessionKey: 'im:qq:bot-1:group:group-9',
      sessionId: 'agent-session-1',
    });
  });
});
