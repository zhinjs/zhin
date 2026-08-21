import { describe, expect, it, vi } from 'vitest';
import { createMemoryContextRepository } from '@zhin.js/ai';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import {
  buildTurnSessionCreateInput,
  beginIngressTurnSession,
  resolveIngressUserMessage,
} from '../../src/session/turn-ingress-session.js';
import { recordPassiveGroupObservation, consumePassiveGroupContextForTurn } from '../../src/session/passive-group-session.js';
import { PromptController } from '../../src/turn/prompt-controller.js';

function turn() {
  return createTurnIngress({
    intent: { kind: 'new' },
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
      references: [{ key: 'ref-1', kind: 'message', sourceId: 'quoted-1', preview: 'previous answer' }],
    },
    session: { key: 'im:qq:bot-1:group:group-9' },
    policy: { permissions: ['trusted'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: () => undefined },
      references: { resolve: async () => ({ status: 'unsupported', code: 'test' }) },
    },
  });
}

function participantTurn(subjectId: string, displayName: string, text: string, turnId: string) {
  return createTurnIngress({
    intent: { kind: 'new' },
    ...turn(),
    identity: { ...turn().identity, turnId },
    principal: { subjectId, displayName, roles: ['user'] },
    input: { text },
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
    });
    const text = result.llmMessage.content.find((block) => block.type === 'text');
    expect(result.llmMessage.actor).toEqual({
      subjectId: 'user-7',
      displayName: 'Ada Lovelace',
      roles: ['trusted', 'admin'],
      scope: 'group',
    });
    expect(result.llmMessage.cause).toEqual({
      turnId: 'turn',
      intent: 'new',
    });
    expect(text?.type === 'text' && text.text).toContain('previous answer');
    expect(text?.type === 'text' && text.text).toContain('quoted-1');
    expect(text?.type === 'text' && text.text).toContain('hello');
  });

  it('layers passive group context drained by canonical session identity', async () => {
    const input = turn();
    await recordPassiveGroupObservation({
      agentSessionStore: { getOrCreateActive: vi.fn().mockResolvedValue({ session_id: 's1' }) },
    } as never, {
      sessionKey: input.session.key,
      senderId: 'peer-1',
      senderName: 'Grace',
      text: 'prior group context',
    });

    const passiveBlock = consumePassiveGroupContextForTurn(input.session.key);
    const result = resolveIngressUserMessage(input, { passiveBlock });
    const text = result.llmMessage.content.find((block) => block.type === 'text');
    expect(text?.type === 'text' && text.text).toContain('prior group context');
    expect(text?.type === 'text' && text.text).toContain('hello');
  });

  it('projects the origin-neutral Agent session identity', () => {
    expect(buildTurnSessionCreateInput(turn())).toEqual({
      session_key: 'im:qq:bot-1:group:group-9',
    });
  });

  it('opens origin-neutral Agent sessions without an IM transcript projection', () => {
    const http = createTurnIngress({
    intent: { kind: 'new' },
      ...turn(),
      origin: { kind: 'http', sessionId: 'http-1' },
      session: { key: 'http:http-1' },
      principal: { subjectId: 'api-user', roles: ['user'] },
      input: { text: 'hello' },
    });
    expect(buildTurnSessionCreateInput(http)).toEqual({ session_key: 'http:http-1' });
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

  it('runs a two-participant shared-group steering fixture without anonymizing either user', async () => {
    const { repository, sessionStore } = createMemoryContextRepository();
    const alice = participantTurn('alice-id', 'Alice', '先不要改数据库', 'turn-alice');
    const bob = participantTurn('bob-id', 'Bob', '可以直接迁移 schema', 'turn-bob');
    const session = await sessionStore.getOrCreateActive(buildTurnSessionCreateInput(alice));
    const aliceMessage = resolveIngressUserMessage(alice);
    const bobMessage = resolveIngressUserMessage(bob);
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const active = controller.schedule({
      turnId: alice.identity.turnId,
      intent: alice.intent,
      principal: alice.principal,
      sessionKey: alice.session.key,
      sessionId: session.session_id,
      userMessages: [aliceMessage.llmMessage],
      execute: async (initial, hooks) => {
        await gate;
        const steered = await hooks.getSteeringMessages();
        await repository.appendMessages(session.session_id, [...initial, ...steered], {
          messageExtras: [aliceMessage.extra, ...steered.map(() => undefined)],
        });
        return {
          reply: 'ok',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          path: 'chat' as const,
          iterations: 1,
          model: 'fixture',
          toolCalls: [],
        };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.schedule({
      turnId: bob.identity.turnId,
      intent: {
        kind: 'steer', targetTurnId: alice.identity.turnId, authorizedBy: 'product_policy',
      },
      principal: bob.principal,
      sessionKey: bob.session.key,
      sessionId: session.session_id,
      userMessages: [bobMessage.llmMessage],
      execute: async () => { throw new Error('steering must use the active turn'); },
    });
    release();
    await active;

    const restored = await repository.loadContext(session.session_id);
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0]).toMatchObject({
      role: 'user', actor: { subjectId: 'alice-id', displayName: 'Alice' },
    });
    expect(restored.messages[1]).toMatchObject({
      role: 'user', actor: { subjectId: 'bob-id', displayName: 'Bob' },
    });
    expect(JSON.stringify(restored.messages[0])).toContain('sender:id=alice-id');
    expect(JSON.stringify(restored.messages[1])).toContain('sender:id=bob-id');
  });
});
