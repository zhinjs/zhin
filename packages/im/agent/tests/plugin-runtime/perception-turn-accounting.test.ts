/**
 * #1250: what the interactive turn does with the perception pre-pass — every request one `usage` event
 * (fallbacks not merged, estimates marked as not reported, cancelled requests included), and the
 * framework note after a description when the turn can collaborate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import type { MediaPerceptionPort } from '../../src/media/perception.js';

const collaborate = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/collaboration/turn-collaboration.js', async (original) => {
  const actual = await original<typeof import('../../src/collaboration/turn-collaboration.js')>();
  return {
    ...actual,
    startTurnCollaboration: async () => collaborate.on
      ? { harness: {} as never, directory: {} as never, root: {} as never, tools: [], replied: () => undefined, finish: async () => undefined }
      : undefined,
  };
});

const { createFullAgentTurnEngine } = await import('../../src/plugin-runtime/full-agent-turn-engine.js');
const { PERCEPTION_DELEGATION_NOTE } = await import('../../src/turn/inbound-media.js');

const estimate = { prompt_tokens: 1_050, completion_tokens: 0, total_tokens: 1_050 };
const reported = { prompt_tokens: 300, completion_tokens: 12, total_tokens: 312 };

/** A port that tries a failing primary, then a backup that answers. */
const fallbackPort: MediaPerceptionPort = {
  kinds: ['image'],
  maxItemsPerTurn: 4,
  accepts: () => true,
  describe: async (_payload, _signal, observe) => {
    observe?.({ provider: 'svc-a', model: 'primary', status: 'failed', usage: estimate, usageReported: false, durationMs: 4 });
    observe?.({ provider: 'svc-b', model: 'backup', status: 'completed', usage: reported, usageReported: true, durationMs: 9 });
    return { text: '一个红圈', provider: 'b', model: 'backup', cached: false,
      usage: { prompt_tokens: 1_350, completion_tokens: 12, total_tokens: 1_362 } };
  },
};

function harness(options: { perception: MediaPerceptionPort; signal?: AbortSignal }) {
  const agentEvents = new AgentEventBus();
  const inputs: Array<{ initialMessages?: unknown }> = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 7, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g1', messageId: 'm-1' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: '这是什么', media: [{ kind: 'image', source: { kind: 'base64', value: 'iVBORw0KGgo=' }, mimeType: 'image/png' }] },
    session: { key: 'im:icqq:bot:group:g1' },
    policy: { permissions: ['user'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: options.signal ?? new AbortController().signal,
    ports: { journal: { append: async () => undefined }, reply: { send: async () => ({ status: 'sent' as const }) } },
  });
  const core = {
    runText(input: { initialMessages?: unknown }) {
      inputs.push(input);
      return (async function* () {
        yield { type: 'turn_end' as const, output: [{ type: 'text' as const, content: '红圈' }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        return { reply: '红圈', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, path: 'agent' as const, iterations: 1, model: 'model', toolCalls: [] };
      })();
    },
  };
  const host = {
    emitter: new ZhinAgentEventEmitter(agentEvents),
    config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) },
    usageQuota: { check: () => ({ allowed: true }), record: vi.fn() },
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }), setDeferredToolSnapshot: async () => undefined },
    promptController: new PromptController('one-at-a-time', 'one-at-a-time'),
    activeBinding: { providerAlias: 'provider', model: 'model', nickname: 'bot' },
    mediaPerception: options.perception,
    finalizeActiveTurn: vi.fn(async () => undefined),
  };
  const engine = createFullAgentTurnEngine({
    host: host as never,
    core: core as never,
    sessionSystem: {
      prepareIngressTurn: vi.fn(async () => ({ sessionKey: turn.session.key, userId: 'user', sessionId: 'sid', isNewSession: false,
        turnUser: { rawContent: '这是什么', promptMessages: [createUserMessage('这是什么')] } })),
      touchAfterTurn: vi.fn(async () => undefined),
    } as never,
    contextSystem: {
      buildTextTurnContext: vi.fn(async () => ({ userMessages: [createUserMessage('这是什么')], personaEnhanced: 'persona',
        modelCandidates: ['model'], modelId: 'model', providerAlias: 'provider', turnEnvelope: null, modelInput: ['text'] })),
    } as never,
  });
  async function run(): Promise<{ events: Array<Record<string, unknown>>; error?: unknown }> {
    const stream = engine.run({
      turn,
      capabilities: { generation: 7, owner: rootPluginId(), tools: [], skills: [], agents: [], mcp: [], promptSections: [] },
      toolCapabilities: [],
      tools: new TurnToolRuntime(turn, []),
      selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] } as never,
    });
    const events: Array<Record<string, unknown>> = [];
    try {
      while (true) {
        const step = await stream.next();
        if (step.done) { await step.value?.project(); break; }
        events.push(step.value as Record<string, unknown>);
      }
    } catch (error) {
      return { events, error };
    } finally { agentEvents.clear(); }
    return { events };
  }
  return { run, inputs };
}

const usageEvents = (events: Array<Record<string, unknown>>) => events.filter(event => event.type === 'usage');

afterEach(() => { collaborate.on = false; });

describe('perception requests are model calls of the turn (#1250)', () => {
  it('one usage event per candidate request: service id, stop reason, and estimates marked as not reported', async () => {
    const { events } = await harness({ perception: fallbackPort }).run();
    expect(usageEvents(events)).toEqual([
      expect.objectContaining({ purpose: 'media_perception', provider: 'svc-a', model: 'primary', stopReason: 'error',
        usage: { promptTokens: 1_050, completionTokens: 0, totalTokens: 1_050, reported: { input: false, output: false, totalTokens: false } } }),
      expect.objectContaining({ purpose: 'media_perception', provider: 'svc-b', model: 'backup', stopReason: 'stop',
        usage: { promptTokens: 300, completionTokens: 12, totalTokens: 312 } }),
    ]);
  });

  it('still reports a request that was in flight when the turn was cancelled', async () => {
    const controller = new AbortController();
    const cancelling: MediaPerceptionPort = {
      ...fallbackPort,
      describe: async (_payload, _signal, observe) => {
        controller.abort(new Error('stopped'));
        observe?.({ provider: 'svc-a', model: 'primary', status: 'cancelled', usage: estimate, usageReported: false, durationMs: 2 });
        throw new Error('aborted');
      },
    };
    const { events, error } = await harness({ perception: cancelling, signal: controller.signal }).run();
    expect(error).toBeDefined();
    expect(usageEvents(events)).toEqual([expect.objectContaining({ provider: 'svc-a', stopReason: 'aborted',
      usage: expect.objectContaining({ reported: { input: false, output: false, totalTokens: false } }) })]);
  });
});

describe('framework note after a perception description (#1250 vision-ask-after-perception)', () => {
  const text = (inputs: Array<{ initialMessages?: unknown }>) => JSON.stringify(inputs[0]?.initialMessages ?? []);

  it('the model of a collaborating turn is told the media is described and how to attach it', async () => {
    collaborate.on = true;
    const { run, inputs } = harness({ perception: fallbackPort });
    await run();
    expect(inputs).toHaveLength(1);
    expect(text(inputs)).toContain(JSON.stringify(PERCEPTION_DELEGATION_NOTE).slice(1, -1));
    expect(PERCEPTION_DELEGATION_NOTE).toMatch(/attach_media: true/u);
  });

  it('a turn without collaboration gets no note', async () => {
    const { run, inputs } = harness({ perception: fallbackPort });
    await run();
    expect(inputs).toHaveLength(1);
    expect(text(inputs)).toContain('一个红圈');
    expect(text(inputs)).not.toContain('Framework note: the attached media was already described');
  });
});
