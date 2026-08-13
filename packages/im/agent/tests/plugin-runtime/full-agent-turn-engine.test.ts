import { describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import type { AgentTurnExecutionContext } from '../../src/plugin-runtime/agent-runtime.js';

describe('FullAgentTurnEngine', () => {
  it('runs canonical ingress through session, deferred capability, PromptController, and full AgentCore seams', async () => {
    const order: string[] = [];
    const turn = createTurnIngress({
      identity: { rootId: 'root', generation: 7, traceId: 'trace', turnId: 'turn' },
      origin: { kind: 'im', platform: 'sandbox', endpoint: 'main', scope: 'private', sceneId: 'user' },
      principal: { subjectId: 'user', roles: ['user'] },
      input: { text: 'hello' },
      session: { key: 'im:sandbox:main:private:user' },
      policy: { permissions: ['user'], unattended: false },
      capabilities: { tools: [], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: async () => undefined } },
    });
    const sessionSystem = {
      prepareIngressTurn: vi.fn(async () => ({
        sessionKey: turn.session.key,
        userId: 'user',
        sessionId: 'session-id',
        isNewSession: false,
        passiveBlock: null,
        turnUser: { rawContent: 'hello', promptMessages: [createUserMessage('hello')] },
      })),
      touchAfterTurn: vi.fn(async () => { order.push('touch'); }),
    };
    const contextSystem = {
      buildTextTurnContext: vi.fn(async () => ({
        userMessages: [createUserMessage('hello')],
        personaEnhanced: 'persona',
        modelCandidates: ['model'],
        modelId: 'model',
        providerAlias: 'provider',
        turnEnvelope: null,
      })),
    };
    let coreInput: Record<string, unknown> | undefined;
    const core = {
      runText(input: Record<string, unknown>) {
        coreInput = input;
        return (async function* () {
          yield { type: 'chunk' as const, text: 'done', accumulated: 'done' };
          yield {
            type: 'turn_end' as const,
            output: [{ type: 'text' as const, content: 'done' }],
            usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
          };
          return {
            reply: 'done',
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
            path: 'agent' as const,
            iterations: 1,
            model: 'model',
            toolCalls: [],
          };
        })();
      },
    };
    const host = {
      config: { deferredTools: {} },
      rateLimiter: { check: () => ({ allowed: true }) },
      contextRepository: {
        getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }),
        setDeferredToolSnapshot: async () => undefined,
      },
      promptController: new PromptController('one-at-a-time', 'one-at-a-time'),
      activeBinding: { providerAlias: 'provider', model: 'model', nickname: 'bot' },
      finalizeActiveTurn: vi.fn(async () => { order.push('finalize'); }),
    };
    const context: AgentTurnExecutionContext = {
      turn,
      capabilities: {
        generation: 7,
        owner: rootPluginId(),
        tools: [],
        skills: [],
        agents: [],
        mcp: [],
      },
      toolCapabilities: [],
      tools: new TurnToolRuntime(turn, []),
      selection: { mcpServers: [] },
    };
    const engine = createFullAgentTurnEngine({
      host: host as never,
      core: core as never,
      sessionSystem: sessionSystem as never,
      contextSystem: contextSystem as never,
    });
    const events: string[] = [];
    for await (const event of engine.run(context)) {
      events.push(event.type);
      if (event.type === 'turn_end') order.push('terminal');
    }

    expect(events).toEqual(['chunk', 'turn_end']);
    expect(order).toEqual(['touch', 'finalize', 'terminal']);
    expect(coreInput).toMatchObject({
      toolLoading: 'deferred',
      generation: 7,
      turnContext: turn,
    });
    expect((coreInput?.resolvedTools as Array<{ name: string }>).map((tool) => tool.name))
      .toEqual(['discover', 'load_tool', 'load_skill']);
  });
});
