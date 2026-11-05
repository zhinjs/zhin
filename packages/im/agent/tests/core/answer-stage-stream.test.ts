import { executionBundle } from '../helpers/execution-bundle.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage, type AgentMessage, type AgentTool, type Context, type StreamOptions } from '@zhin.js/ai';
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import type { ReplyPhaseLifecycle } from '../../src/core/reply-phase.js';
import { createInteractiveRun, type InteractiveRun } from '../../src/core/interactive-run.js';
import { UsageQuota } from '../../src/security/usage-quota.js';

vi.mock('../../src/prompt/assembly.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));
const { collectAgentLoopTurnRun, runAgentLoopTextTurnRun } = await import('../../src/core/agent-core-run.js');

const structured = (value: string) => JSON.stringify({ messages: [{ segments: [{ type: 'text', data: { text: value } }] }] });
const partial = (value: string) => `{"messages":[{"segments":[{"type":"text","data":{"text":${JSON.stringify(value).slice(0, -1)}`;
const lookup: AgentTool = { name: 'lookup', description: 'Read a member', parameters: { type: 'object', properties: {} } } as AgentTool;

function replyStream() {
  const snapshots: ReplyStreamSnapshot[] = [];
  let receipt: import('@zhin.js/im-contract').DeliveryReceipt = { status: 'suppressed' };
  let acknowledge!: () => void;
  const updated = new Promise<void>(resolve => { acknowledge = resolve; });
  const stream: CoreReplyStream = {
    minIntervalMs: 0, get receipt() { return receipt; }, confirmed: [],
    update: snapshot => { snapshots.push(snapshot); acknowledge(); },
    finish: async () => ({ status: 'sent' }), cancel: async () => ({ status: 'suppressed' }),
  };
  return { stream, snapshots, updated, fail: (code: string) => { receipt = { status: 'failed', failure: { code, message: code, retryable: false } }; } };
}

type Answer = ReturnType<typeof assistantTextReply>;
type Step = (context: Context, options?: StreamOptions) => Answer | Promise<Answer>;
async function run(steps: Step[], options: { tools?: AgentTool[]; stream?: CoreReplyStream; signal?: AbortSignal; retries?: number; maxIterations?: number; replySegments?: import('@zhin.js/core').AiOutboundSegmentProfile; replyPhases?: ReplyPhaseLifecycle; controller?: PromptController; outputSchema?: false | Record<string, unknown>; bot?: boolean; interactiveRun?: InteractiveRun } = {}) {
  const llm = wireMockLlmApi({ models: ['m'] });
  const calls: Context[] = [];
  vi.spyOn(llm.runtime, 'complete').mockImplementation(async (_model, context, opts) => {
    calls.push(context);
    const step = steps.shift();
    if (!step) throw new Error('Unexpected extra completion');
    return step(context, opts);
  });
  const persisted: AgentMessage[] = [];
  const executeTool = vi.fn(async () => ({ status: 'completed' as const, output: 'looked up', durationMs: 1 }));
  const tools = options.tools ?? [];
  const host = {
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async (_id: string, messages: AgentMessage[]) => { persisted.push(...messages); } },
    getTurnExecution: () => executionBundle({ model: { api: 'fixture', provider: (llm.provider).name, input: ['text'], contextWindow: 0, maxTokens: 8192, ...(llm.runtime).model((llm.provider).name, (llm.provider).models?.[0]) }, completion: llm.runtime }), completion: llm.runtime,
    config: { maxIterations: options.maxIterations ?? 3, outputSchema: options.outputSchema, providerResilience: { maxRetries: options.retries ?? 0, emptyReplyRetries: 0 },
      toolExecution: 'sequential', compaction: {}, contextTokens: 100_000,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  };
  const execute = (initialMessages?: AgentMessage[], promptHooks?: import('../../src/turn/prompt-controller.js').PromptTurnHooks, signal = options.signal) => runAgentLoopTextTurnRun({
    host: host as never, sessionId: 'session', rawContent: 'hello', promptProfile: { kind: 'interactive' },
    turnContext: { input: { text: 'hello', ...(options.bot ? { contextState: { bot: { id: 'bot', name: 'Bot' } } } : {}) }, origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'person' },
      principal: { subjectId: 'person', roles: ['master'] }, session: { key: 'session' } },
    replyStream: options.stream, replyPhases: options.replyPhases, replySegments: options.replySegments, allTools: tools, resolvedTools: tools, toolExecution: { execute: executeTool } as never,
    interactiveRun: options.interactiveRun,
    personaEnhanced: '', modelId: 'm', modelCandidates: ['m'], toolLoading: 'direct', signal, initialMessages, promptHooks,
  });
  const events: import('../../src/event/turn-event.js').TurnEvent[] = [];
  const result = await collectAgentLoopTurnRun(options.controller ? options.controller.scheduleStream({
    sessionKey: 'session', sessionId: 'session', intent: { kind: 'new' }, userMessages: [createUserMessage('hello')],
    execute: (messages, hooks, signal) => execute(messages, hooks, signal),
  }) : execute(), event => { events.push(event); });
  return { result, persisted, execute: executeTool, calls, events };
}

afterEach(() => vi.useRealTimers());

describe('public answer stage', () => {
  it('streams a tools-free reply from actual deltas, without an extra completion', async () => {
    const { stream, snapshots, updated } = replyStream();
    const f = await run([async (context, opts) => {
      expect(context.tools).toBeUndefined();
      opts?.onTextDelta?.(partial('hello'));
      await updated;
      expect(snapshots).toHaveLength(1);
      return assistantTextReply(structured('hello there'));
    }], { stream });
    expect(f.calls).toHaveLength(1);
    expect(f.result.progressive?.snapshot?.messages[0]?.segments[0]?.value).toMatchObject({ type: 'text', data: { text: 'hello there' } });
    expect(f.result.reply).toBe('hello there');
  });

  it('publishes only after a sole completed prepare_reply and then removes every tool', async () => {
    const { stream, snapshots, updated } = replyStream();
    const f = await run([
      (_context, opts) => {
        expect(opts?.onTextDelta).toBeUndefined();
        return assistantToolCallReply([{ id: 'read', name: 'lookup', arguments: {} }], 'private draft');
      },
      context => {
        expect(context.tools?.map(tool => tool.name)).toContain('prepare_reply');
        expect(snapshots).toEqual([]);
        return assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]);
      },
      async (context, opts) => {
        expect(context.tools).toBeUndefined();
        opts?.onTextDelta?.(partial('public'));
        await updated;
        expect(snapshots).toHaveLength(1);
        return assistantTextReply(structured('public answer'));
      },
    ], { tools: [lookup], stream });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.result.toolCalls.map(call => call.tool)).toEqual(['lookup']);
    expect(f.result.progressive?.snapshot).toBeDefined();
    await f.result.projectConversation?.({ confirmedOutput: [{ type: 'message', segments: [{ type: 'text', data: { text: 'public' } }] }] });
    expect(f.persisted.some(message => message.role === 'toolResult')).toBe(true);
    expect(f.persisted.filter(message => message.role === 'assistant').at(-1)).toMatchObject({ content: [{ type: 'text', text: structured('public') }] });
  });

  it('projects accepted input and complete tool pairs without claiming an unsent answer', async () => {
    const f = await run([
      () => assistantToolCallReply([{ id: 'read', name: 'lookup', arguments: {} }]),
      () => assistantTextReply(structured('unsent candidate')),
    ], { tools: [lookup] });
    await f.result.projectConversation?.({ confirmedOutput: [] });
    expect(f.persisted[0]).toMatchObject({ role: 'user' });
    const call = f.persisted.find(message => message.role === 'assistant'
      && message.content.some(block => block.type === 'toolCall'));
    expect(call).toMatchObject({ content: [expect.objectContaining({ type: 'toolCall', id: 'read', name: 'lookup' })] });
    expect(f.persisted.find(message => message.role === 'toolResult')).toMatchObject({ toolCallId: 'read', toolName: 'lookup' });
    expect(f.persisted.filter(message => message.role === 'assistant').at(-1)).toMatchObject({
      content: [{ type: 'text', text: JSON.stringify({ messages: [] }) }],
    });
    expect(JSON.stringify(f.persisted)).not.toContain('unsent candidate');
    expect(f.persisted.every(message => !('messageId' in message))).toBe(true);
  });

  it('rejects a mixed prepare_reply without publishing or suppressing ordinary tool work', async () => {
    const { stream, snapshots } = replyStream();
    const f = await run([
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }, { id: 'read', name: 'lookup', arguments: {} }]),
      (context, opts) => {
        expect(context.tools?.map(tool => tool.name)).toContain('lookup');
        expect(opts?.onTextDelta).toBeUndefined();
        return assistantTextReply(structured('completed ordinarily'));
      },
    ], { tools: [lookup], stream });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(snapshots).toEqual([]);
    expect(f.result.progressive).toBeUndefined();
    expect(f.calls).toHaveLength(2);
  });

  it('keeps ordinary terminal answers in one call when no prepare marker was emitted', async () => {
    const { stream, snapshots } = replyStream();
    const f = await run([() => assistantTextReply(structured('done'))], { stream, tools: [lookup] });
    expect(f.calls).toHaveLength(1);
    expect(f.result.reply).toBe('done');
    expect(f.result.progressive).toBeUndefined();
    expect(snapshots).toEqual([]);
  });

  it('does not retry or format-rewrite a failed provider request after offering a prefix', async () => {
    const { stream, snapshots, updated } = replyStream();
    const f = await run([async (_context, opts) => {
      opts?.onTextDelta?.(partial('already public'));
      await updated;
      expect(snapshots).toHaveLength(1);
      throw new Error('503 Service unavailable');
    }], { stream, retries: 2 });
    expect(f.calls).toHaveLength(1);
    expect(f.result.progressive?.run.offered).toBe(true);
    expect(f.result.progressive?.snapshot).toBeUndefined();
  });

  it('keeps a malformed published answer without issuing a format correction', async () => {
    const { stream, updated } = replyStream();
    const f = await run([async (_context, opts) => {
      opts?.onTextDelta?.(partial('safe visible prefix'));
      await updated;
      return assistantTextReply(partial('safe visible prefix') + 'invalid JSON');
    }], { stream });
    expect(f.calls).toHaveLength(1);
    expect(f.result.progressive?.run.offered).toBe(true);
    expect(f.result.progressive?.snapshot).toBeUndefined();
  });

  it('appends confirmed history after a failed tools-off re-completion, preserving the prepare protocol pair', async () => {
    const { stream, updated } = replyStream();
    const f = await run([
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]),
      async (_context, opts) => {
        opts?.onTextDelta?.(partial('confirmed fragment'));
        await updated;
        throw new Error('503 Service unavailable');
      },
    ], { stream, tools: [lookup], maxIterations: 1, retries: 2 });
    expect(f.calls).toHaveLength(2);
    expect(f.result.progressive?.run.offered).toBe(true);
    expect(f.result.progressive?.snapshot).toBeUndefined();
    await f.result.projectConversation?.({ confirmedOutput: [{ type: 'message', segments: [{ type: 'text', data: { text: 'confirmed fragment' } }] }] });
    expect(f.persisted).toHaveLength(4);
    expect(f.persisted[1]).toMatchObject({ role: 'assistant', content: [{ type: 'toolCall', name: 'prepare_reply' }] });
    expect(f.persisted[2]).toMatchObject({ role: 'toolResult', toolName: 'prepare_reply' });
    expect(f.persisted[3]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: structured('confirmed fragment') }] });
  });

  it('falls back to the ordinary complete reply when a nonempty reaction must precede words', async () => {
    const { stream, snapshots } = replyStream();
    const f = await run([(_context, opts) => {
      opts?.onTextDelta?.(partial('held while reaction is unknown'));
      return assistantTextReply('{"messages":[{"segments":[{"type":"text","data":{"text":"done"}}]}],"reaction":"ok"}');
    }], { stream, replySegments: { types: ['text'], reaction: { values: [{ value: 'ok', label: 'OK' }] } } });
    expect(snapshots).toEqual([]);
    expect(f.result.progressive).toBeUndefined();
    expect(f.result.output?.[0]).toMatchObject({ type: 'message', segments: [{ type: 'reaction' }] });
    expect(f.calls).toHaveLength(1);
  });

  it('stops rather than moving a changed final reaction behind already published words', async () => {
    const { stream, updated } = replyStream();
    const f = await run([async (_context, opts) => {
      opts?.onTextDelta?.('{"reaction":"",' + partial('visible').slice(1));
      await updated;
      return assistantTextReply('{"reaction":"","messages":[{"segments":[{"type":"text","data":{"text":"visible"}}]}],"reaction":"ok"}');
    }], { stream, replySegments: { types: ['text'], reaction: { values: [{ value: 'ok', label: 'OK' }] } } });
    expect(f.result.progressive?.run.offered).toBe(true);
    expect(f.result.progressive?.snapshot).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });

  it('aborts provider consumption on the Core resource limit and never regenerates', async () => {
    const { stream, fail } = replyStream();
    vi.spyOn(stream, 'update').mockImplementation(() => { fail('stream_buffer_limit'); });
    const f = await run([async (_context, opts) => {
      opts?.onTextDelta?.(partial('candidate refused by the semantic cap'));
      return new Promise<Answer>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => { reject(opts.signal?.reason); }, { once: true });
      });
    }], { stream, retries: 2 });
    expect(f.calls).toHaveLength(1);
    expect(f.result.progressive?.run.error).toBeInstanceOf(Error);
    expect(f.result.progressive?.snapshot).toBeUndefined();
    expect(f.result.progressive?.run.failureSignal.aborted).toBe(true);
    expect(stream.receipt.failure?.code).toBe('stream_buffer_limit');
  });

  it('returns the published descriptor and preserves a projection source on abort', async () => {
    const { stream, updated } = replyStream();
    const controller = new AbortController();
    const f = await run([async (_context, opts) => {
      opts?.onTextDelta?.(partial('before cancellation'));
      await updated;
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    }], { stream, signal: controller.signal });
    expect(f.result.progressive?.run.offered).toBe(true);
    expect(f.result.progressive?.snapshot).toBeUndefined();
    await f.result.projectConversation?.({ confirmedOutput: [{ type: 'message', segments: [{ type: 'text', data: { text: 'before cancellation' } }] }] });
    expect(f.persisted.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: structured('before cancellation') }] });
  });
});

describe('real PromptController answer phases', () => {
  it.each([false, { type: 'object', properties: { answer: { type: 'string' } } }])('keeps ordinary delivery provenance for custom/non-IM output schema %j', async outputSchema => {
    const open = vi.fn(() => ({ id: 'unused', stream: replyStream().stream }));
    const settle = vi.fn();
    const f = await run([() => assistantTextReply('ordinary result')], { outputSchema, replyPhases: { open, settle } });
    expect(open).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(f.result.replyPhaseId).toBeUndefined();
    await f.result.projectConversation?.({ messageId: 'ordinary-native-id', messageIds: ['ordinary-native-id'], contextRefs: ['ordinary-ref'] });
    expect(f.persisted.at(-1)).toMatchObject({ role: 'assistant', messageId: 'ordinary-native-id', contextRefs: ['ordinary-ref'] });
  });

  it('keeps both delivered answers and follow-up history in one terminal without replay', async () => {
    const controller = new PromptController('all', 'all');
    const streams: ReturnType<typeof replyStream>[] = [];
    const phases: import('../../src/core/reply-phase.js').ReplyAnswerPhase[] = [];
    const lifecycle: ReplyPhaseLifecycle = {
      open() { const next = replyStream(); streams.push(next); return { id: `answer-${streams.length}`, stream: next.stream }; },
      async settle(phase) {
        phases.push(phase);
        const confirmedOutput = [{ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: `confirmed-${phase.id}` } }] }];
        return { delivery: { status: 'sent', messageId: phase.id }, confirmedOutput, messageId: phase.id, messageIds: [phase.id], contextRefs: [`phase-ref-${phase.id}`] };
      },
    };
    const f = await run([
      async (_context, opts) => {
        opts?.onTextDelta?.(partial('first preview'));
        await streams[0]!.updated;
        controller.followUp('session', createUserMessage('second question'));
        return { ...assistantTextReply(structured('first answer')), contextRefs: ['provider-forged-ref'], messageIds: ['provider-forged-id'] };
      },
      async (context, opts) => {
        expect(JSON.stringify(context.messages)).toContain('confirmed-answer-1');
        opts?.onTextDelta?.(partial('second preview'));
        await streams[1]!.updated;
        return assistantTextReply(structured('second answer'));
      },
    ], { controller, replyPhases: lifecycle, bot: true });
    expect(f.calls).toHaveLength(2);
    expect(f.events.filter(event => event.type === 'turn_end')).toHaveLength(1);
    expect(phases.map(phase => phase.id)).toEqual(['answer-1', 'answer-2']);
    expect(phases.every(phase => phase.snapshot?.messages[0]?.complete)).toBe(true);
    expect(f.result.replyPhaseId).toBe('answer-2');
    await f.result.projectConversation?.();
    expect(f.persisted.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(JSON.stringify(f.persisted)).toContain('second question');
    expect(JSON.stringify(f.persisted)).not.toContain('provider-forged');
    expect(f.persisted.filter(message => message.role === 'assistant').map(message => message.content)).toEqual([
      [{ type: 'text', text: structured('confirmed-answer-1') }], [{ type: 'text', text: structured('confirmed-answer-2') }],
    ]);
    expect(f.persisted.filter(message => message.role === 'assistant').map(message => ({
      messageIds: message.messageIds, contextRefs: message.contextRefs,
    }))).toEqual([
      { messageIds: ['answer-1'], contextRefs: ['phase-ref-answer-1'] },
      { messageIds: ['answer-2'], contextRefs: ['phase-ref-answer-2'] },
    ]);
  });
  it('keeps the confirmed assistant after a failed prepared phase even when the loop swallows the failed re-completion', async () => {
    const next = replyStream();
    const f = await run([
      () => assistantToolCallReply([{ id: 'prepare', name: 'prepare_reply', arguments: {} }]),
      async (_context, opts) => {
        opts?.onTextDelta?.(partial('confirmed partial'));
        await next.updated;
        throw new Error('503 Service unavailable');
      },
    ], { tools: [lookup], maxIterations: 1, replyPhases: {
      open: () => ({ id: 'partial-phase', stream: next.stream }),
      async settle(phase) {
        expect(phase.run?.offered).toBe(true);
        expect(phase.snapshot).toBeUndefined();
        return { delivery: { status: 'failed', code: 'provider_failed' }, stopped: true,
          confirmedOutput: [{ type: 'message', segments: [{ type: 'text', data: { text: 'confirmed partial' } }] }] };
      },
    } });
    expect(f.result.replyPhaseStopped).toBe(true);
    await f.result.projectConversation?.();
    expect(f.persisted.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(f.persisted.at(-1)).toMatchObject({ content: [{ type: 'text', text: structured('confirmed partial') }] });
  });

  it('restores only the original tool catalog for an admitted follow-up after public answering', async () => {
    const controller = new PromptController('all', 'all');
    const streams: ReturnType<typeof replyStream>[] = [];
    const phases: import('../../src/core/reply-phase.js').ReplyAnswerPhase[] = [];
    const lifecycle: ReplyPhaseLifecycle = {
      open() { const next = replyStream(); streams.push(next); return { id: `tools-${streams.length}`, stream: next.stream }; },
      async settle(phase) { phases.push(phase); return { delivery: { status: 'sent' }, confirmedOutput: [...phase.output] }; },
    };
    const ready = (id: string) => assistantToolCallReply([{ id, name: 'prepare_reply', arguments: {} }]);
    const f = await run([
      () => assistantToolCallReply([{ id: 'read-1', name: 'lookup', arguments: {} }]),
      () => ready('ready-1'),
      async (_context, opts) => {
        opts?.onTextDelta?.(partial('first'));
        await streams[0]!.updated;
        controller.followUp('session', createUserMessage('look again'));
        return assistantTextReply(structured('first answer'));
      },
      (context, opts) => {
        expect(context.tools?.map(tool => tool.name)).toEqual(['lookup', 'prepare_reply']);
        expect(opts?.onTextDelta).toBeUndefined();
        return assistantToolCallReply([{ id: 'read-2', name: 'lookup', arguments: {} }]);
      },
      () => ready('ready-2'),
      async (context, opts) => {
        expect(context.tools).toBeUndefined();
        opts?.onTextDelta?.(partial('second'));
        await streams[1]!.updated;
        return assistantTextReply(structured('second answer'));
      },
    ], { controller, replyPhases: lifecycle, tools: [lookup] });
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(phases).toHaveLength(2);
    expect(f.events.filter(event => event.type === 'turn_end')).toHaveLength(1);
    await f.result.projectConversation?.();
    expect(f.persisted).toHaveLength(12);
    expect(f.persisted.filter(message => message.role === 'toolResult')).toHaveLength(4);
    expect(f.persisted.filter(message => message.role === 'user')).toHaveLength(2);
  });

  it('honors steering at its existing post-tool boundary without upgrading late steering into a follow-up', async () => {
    const controller = new PromptController('all', 'all');
    const streams: ReturnType<typeof replyStream>[] = [];
    const phases: import('../../src/core/reply-phase.js').ReplyAnswerPhase[] = [];
    const lifecycle: ReplyPhaseLifecycle = {
      open() { const next = replyStream(); streams.push(next); return { id: `steer-${streams.length}`, stream: next.stream }; },
      async settle(phase) { phases.push(phase); return { delivery: { status: 'sent' }, confirmedOutput: [...phase.output] }; },
    };
    const ready = (id: string) => assistantToolCallReply([{ id, name: 'prepare_reply', arguments: {} }]);
    const f = await run([
      () => ready('ready-1'),
      async (_context, opts) => {
        opts?.onTextDelta?.(partial('first'));
        await streams[0]!.updated;
        controller.steer('session', createUserMessage('authorized steering'));
        return assistantTextReply(structured('first answer'));
      },
      context => {
        expect(JSON.stringify(context.messages)).toContain('authorized steering');
        return ready('ready-2');
      },
      () => assistantTextReply(structured('steered answer')),
    ], { controller, replyPhases: lifecycle, tools: [lookup] });
    expect(f.execute).not.toHaveBeenCalled();
    expect(phases).toHaveLength(2);
    expect(f.events.filter(event => event.type === 'turn_end')).toHaveLength(1);
    await f.result.projectConversation?.();
    expect(f.persisted.filter(message => message.role === 'user')).toHaveLength(2);

    const lateController = new PromptController('all', 'all');
    let opened = 0;
    const late = await run([() => {
      lateController.steer('session', createUserMessage('late steering'));
      return assistantTextReply(structured('already terminal'));
    }], { controller: lateController, replyPhases: {
      open() { return { id: `late-${++opened}`, stream: replyStream().stream }; },
      async settle(phase) { return { delivery: { status: 'sent' }, confirmedOutput: [...phase.output] }; },
    } });
    expect(late.calls).toHaveLength(1);
    expect(opened).toBe(1);
  });

});

describe('retry candidate epochs', () => {
  it('ignores an earlier asynchronous parse and late delta after a prepublication retry', async () => {
    vi.useFakeTimers();
    const { stream, snapshots } = replyStream();
    const run = new ReplyStreamRun(stream);
    const first = run.begin();
    run.append(partial('stale'), first);
    vi.advanceTimersByTime(0);
    const second = run.begin();
    run.append(partial('fresh'), second);
    run.append('late old delta', first);
    await vi.runAllTimersAsync();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.messages[0]?.segments[0]?.value).toMatchObject({ data: { text: 'fresh' } });
    await run.stop();
  });
});

it('stops admitted follow-ups at the real quota boundary even when the Host explanation is sent', async () => {
  const controller = new PromptController('all', 'all');
  const quota = new UsageQuota({ perUserTokens: 1, exemptOwner: false });
  const subject = { userId: 'person', owner: false };
  quota.record(subject, 1);
  const interactiveRun = createInteractiveRun(quota, subject, 0);
  let settled = 0;
  const lifecycle: ReplyPhaseLifecycle = {
    open: () => ({ id: `quota-answer-${settled + 1}`, stream: replyStream().stream }),
    async settle(phase) {
      if (++settled === 1) {
        controller.followUp('session', createUserMessage('first pending follow-up'));
        controller.followUp('session', createUserMessage('second pending follow-up'));
      }
      return { delivery: { status: 'sent' }, confirmedOutput: [...phase.output] };
    },
  };
  const f = await run([], { controller, replyPhases: lifecycle, interactiveRun });
  expect(f.calls).toHaveLength(0);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.result.stoppedReason).toBe(interactiveRun.check());
  expect(settled).toBe(1);
  expect(f.result.replyPhaseStopped).toBe(true);
  expect(f.events.filter(event => event.type === 'turn_end')).toHaveLength(1);
});
