/**
 * #1250 第 56 批: a root turn with collaboration never shows `[[no_reply]]`, also when its answer is
 * streamed (progressive phases settle from the stream snapshot, not from the cleaned output).
 */
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { createUserMessage } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { AgentLoopTurnInput } from '../../src/core/agent-core-run.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { UsageQuota } from '../../src/security/usage-quota.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';
import { createCoreReplyStream } from '../../../core/src/plugin-runtime/im/progressive-reply.js';

const replied = vi.fn();
vi.mock('../../src/collaboration/turn-collaboration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/collaboration/turn-collaboration.js')>()),
  startTurnCollaboration: async () => ({ tools: [], replied, finish: async () => undefined }),
}));

const MARKED = '这是一只橘猫。 `[[no_reply]]`';
const text = (value: string) => ({ type: 'text' as const, data: { text: value } });
const snapshotOf = (value: string, complete = true): ReplyStreamSnapshot => ({ revision: complete ? 2 : 1, messages: [{ key: 'message-0', complete,
  segments: [{ key: 'segment-0', complete, value: text(value) }] }] });

type Mode = 'phase-stream' | 'phase-send' | 'progressive' | 'real-stream';

/** A real core reply stream over a native endpoint stream that records every frame it is given. */
function realCoreStream() {
  const conversation = { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private' as const, id: 'user' };
  const frames: string[] = [];
  const stream = createCoreReplyStream({
    endpoint: { signal: new AbortController().signal, send: async () => 'ordinary', assertActive: () => undefined },
    streaming: { mode: 'native', minIntervalMs: 0, open: () => ({
      write: async (value: string) => { frames.push(value); return { status: 'sent', messageId: 'native-1', acceptedText: value }; },
      finish: async (value: string) => { frames.push(value); return { status: 'sent', messageId: 'native-1', acceptedText: value }; },
      cancel: () => undefined,
    }) },
    options: {}, release() {},
    async deliver(content, execution) {
      const result = await execution.send({ conversation, payload: content });
      if (result.result === undefined) return { status: 'suppressed' };
      const message = { conversation, id: String(result.result) };
      execution.confirmed({ message }, result.contentUnavailable ? undefined : result.confirmedContent);
      return { status: 'sent', message };
    },
  } as never);
  return { stream, frames };
}

async function runRootTurn(mode: Mode, real = mode === 'real-stream' ? realCoreStream() : undefined) {
  const conversation = { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private' as const, id: 'user' };
  const message = { conversation, id: 'physical' };
  const receipt = { status: 'sent' as const, parts: [{ message }], message };
  const native: CoreReplyStream = real?.stream ?? { receipt, confirmed: [{ key: 'physical', message, segments: [text('这是一只橘猫。')] }],
    update: vi.fn(), finish: vi.fn(async () => receipt), cancel: vi.fn(async () => receipt) };
  const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 'ordinary' }));
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'user', conversation },
    principal: { subjectId: 'user', roles: ['user'] }, input: { text: 'hello' }, session: { key: 'sandbox:bot:private:user' },
    policy: { permissions: ['user'], unattended: false }, capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => undefined }, reply: { send, openStream: () => native } },
  });
  const host = { emitter: new ZhinAgentEventEmitter(new AgentEventBus()), config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) }, usageQuota: new UsageQuota(),
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }), setDeferredToolSnapshot: async () => undefined },
    promptController: new PromptController('one-at-a-time', 'one-at-a-time'), activeBinding: { providerAlias: 'provider', model: 'model' },
    toldLedger: { record: vi.fn(), renderBlocks: () => [] }, finalizeActiveTurn: vi.fn() };
  const output = [{ type: 'message' as const, segments: [text(MARKED)] }];
  const engine = createFullAgentTurnEngine({ host: host as never,
    core: { runText(input: AgentLoopTurnInput) { return (async function* () {
      let phaseId: string | undefined;
      if (mode === 'real-stream') {
        // The model is still writing: an intermediate update reaches the platform before the marker is complete.
        input.replyStream!.update(snapshotOf('这是一只橘猫。 `[[no_', false));
        await vi.waitFor(() => expect(real!.frames.length, JSON.stringify(input.replyStream!.receipt)).toBeGreaterThan(0));
      }
      if ((mode === 'phase-stream' || mode === 'phase-send') && input.replyPhases) {
        const phase = input.replyPhases.open(); phaseId = phase.id;
        await input.replyPhases.settle({ id: phase.id, reply: MARKED, output,
          ...(mode === 'phase-stream' ? { run: new ReplyStreamRun(phase.stream!), snapshot: snapshotOf(MARKED) } : {}) });
      }
      yield { type: 'turn_end' as const, output, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return { reply: MARKED, output, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        path: 'chat' as const, iterations: 1, model: 'model', toolCalls: [], projectConversation: async () => undefined,
        ...(phaseId ? { replyPhaseId: phaseId } : {}),
        ...(mode === 'progressive' || mode === 'real-stream' ? { progressive: { run: new ReplyStreamRun(input.replyStream!), snapshot: snapshotOf(MARKED) } } : {}) };
    })(); } } as never,
    sessionSystem: { prepareIngressTurn: async () => ({ sessionKey: turn.session.key, userId: 'user', sessionId: 'session', isNewSession: false,
      turnUser: { rawContent: 'hello', promptMessages: [createUserMessage('hello')] } }), touchAfterTurn: async () => undefined } as never,
    contextSystem: { buildTextTurnContext: async () => ({ userMessages: [createUserMessage('hello')], personaEnhanced: 'persona',
      modelCandidates: ['model'], modelId: 'model', providerAlias: 'provider', modelSdk: 'google', turnEnvelope: null }) } as never,
  });
  const stream = engine.run({ turn, capabilities: { generation: 1, owner: rootPluginId(), tools: [], skills: [], agents: [], mcp: [], promptSections: [] },
    toolCapabilities: [], tools: new TurnToolRuntime(turn, []), selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] } });
  while (true) {
    const step = await stream.next();
    if (step.done) { await step.value.project(); break; }
  }
  return { native, send, frames: real?.frames ?? [] };
}

describe('root turn answers drop [[no_reply]] (#1250 第 56 批)', () => {
  beforeEach(() => replied.mockClear());

  it.each(['phase-stream', 'progressive'] as const)('finishes the %s stream with the marker stripped', async (mode) => {
    const { native } = await runRootTurn(mode);
    expect(native.finish).toHaveBeenCalledOnce();
    expect(native.finish).toHaveBeenCalledWith(snapshotOf('这是一只橘猫。 '));
  });

  it('never publishes the marker through a real core stream, updates included, and still delivers', async () => {
    const { native, frames } = await runRootTurn('real-stream');
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const frame of frames) expect(frame).not.toMatch(/no_|\[\[|`/u);
    expect(frames.at(-1)).toBe('这是一只橘猫。 ');
    // The finish appends to what the update published: no stream_prefix_changed, the answer counts as told.
    expect(native.receipt).toMatchObject({ status: 'sent' });
    expect(replied).toHaveBeenCalledWith('这是一只橘猫。 ');
  });

  it('passes the finish on unchanged when a marker was already published, so the delivery does not fail', async () => {
    const { withoutNoReplyStream } = await import('../../src/collaboration/turn-collaboration.js');
    const receipt = { status: 'sent' as const };
    const inner: CoreReplyStream = { receipt, confirmed: [{ key: 'k', segments: [text('答案 [[no_reply]]')] }],
      update: vi.fn(), finish: vi.fn(async () => receipt), cancel: vi.fn(async () => receipt) };
    const port = withoutNoReplyStream({ send: vi.fn(), openStream: () => inner });
    const final = snapshotOf('答案 [[no_reply]]');
    await port.openStream!()!.finish(final);
    expect(inner.finish).toHaveBeenCalledWith(final);
  });

  it('sends a non-streamed answer phase with the marker stripped', async () => {
    const { send } = await runRootTurn('phase-send');
    expect(send).toHaveBeenCalledWith([{ type: 'message', segments: [text('这是一只橘猫。')] }], expect.objectContaining({ intent: 'answer' }));
    expect(JSON.stringify(send.mock.calls)).not.toContain('no_reply');
    expect(replied).toHaveBeenCalledWith('这是一只橘猫。');
  });
});
