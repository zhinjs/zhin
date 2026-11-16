import { executionBundle } from '../helpers/execution-bundle.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentTool, Context, StreamOptions } from '@zhin.js/ai';
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';
import { appendConversationBatches, encodeConfirmedOutput } from '../../src/core/agent-core-settlement.js';
import { deliverProgressiveReply } from '../../src/outbound/progressive-reply-delivery.js';
import type { ReplyPhaseFacts, ReplyPhaseLifecycle } from '../../src/core/reply-phase.js';
import type { AgentOutputElement } from '../../src/outbound/agent-output.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { registerTurnTrace } from '../../src/trace/turn-trace-registry.js';

vi.mock('../../src/prompt/assembly.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));
const { collectAgentLoopTurnRun, runAgentLoopTextTurnRun } = await import('../../src/core/agent-core-run.js');

/** ~19 KB of "mp3": the size of the clip in the owner's report. */
const AUDIO = Buffer.from(Array.from({ length: 19_000 }, (_, index) => (index * 31 + 5) % 256)).toString('base64');
const voiceTts: AgentTool = { name: 'voice_tts', description: 'Synthesize a voice reply', parameters: { type: 'object', properties: { text: { type: 'string' } } } } as AgentTool;
const structured = (segments: unknown[]) => JSON.stringify({ messages: [{ segments }] });

function replyStream() {
  const snapshots: ReplyStreamSnapshot[] = [];
  const stream: CoreReplyStream = {
    minIntervalMs: 0, get receipt() { return { status: 'suppressed' } as const; }, confirmed: [],
    update: snapshot => { snapshots.push(snapshot); },
    finish: async () => ({ status: 'sent' }), cancel: async () => ({ status: 'suppressed' }),
  };
  return { stream, snapshots };
}

type Answer = ReturnType<typeof assistantTextReply>;
type Step = (context: Context, options?: StreamOptions) => Answer | Promise<Answer>;

/** One session whose history survives between turns (persisted messages are loaded by the next turn). */
function session() {
  const persisted: AgentMessage[] = [];
  const calls: string[] = [];
  const turn = async (steps: Step[], stream: CoreReplyStream | undefined, turnId: string, replyPhases?: ReplyPhaseLifecycle) => {
    const llm = wireMockLlmApi({ models: ['m'] });
    vi.spyOn(llm.runtime, 'complete').mockImplementation(async (_model, context, opts) => {
      calls.push(JSON.stringify(context.messages));
      const step = steps.shift();
      if (!step) throw new Error('Unexpected extra completion');
      return step(context, opts);
    });
    const executeTool = vi.fn(async () => ({ status: 'completed' as const, output: { audio: AUDIO, format: 'mp3', size: 19_000 }, durationMs: 1 }) as never);
    const host = {
      contextRepository: {
        loadContext: async () => ({ messages: [...persisted] }),
        appendMessages: async (_id: string, messages: AgentMessage[]) => { persisted.push(...messages); },
      },
      getTurnExecution: () => executionBundle({ model: { api: 'fixture', provider: llm.provider.name, input: ['text'], contextWindow: 0, maxTokens: 8192, ...llm.runtime.model(llm.provider.name, llm.provider.models?.[0]) }, completion: llm.runtime }), completion: llm.runtime,
      config: { maxIterations: 4, providerResilience: { maxRetries: 0, emptyReplyRetries: 0 },
        toolExecution: 'sequential', compaction: {}, contextTokens: 100_000,
        toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
      compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
      getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
    };
    const replySegments = { types: ['text', 'audio'] } as never;
    const result = await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
      host: host as never, sessionId: 'session', rawContent: 'hello', promptProfile: { kind: 'interactive' },
      turnContext: { identity: { turnId }, input: { text: '用语音说你好' }, origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'person' },
        principal: { subjectId: 'person', roles: ['owner'] }, session: { key: 'session' } },
      replyStream: stream, replyPhases, replySegments, allTools: [voiceTts], resolvedTools: [voiceTts], toolExecution: { execute: executeTool } as never,
      personaEnhanced: '', modelId: 'm', modelCandidates: ['m'], toolLoading: 'direct',
    } as never), () => {});
    return { result, executeTool };
  };
  return { persisted, calls, turn };
}

afterEach(() => vi.restoreAllMocks());

/**
 * A platform stream that confirms exactly the segments of the snapshot it finishes with, like the
 * production Core reply stream does for a platform without edit-in-place.
 */
function confirmingStream(id: string) {
  const confirmed: CoreReplyStream['confirmed'][number][] = [];
  let receipt: CoreReplyStream['receipt'] = { status: 'suppressed' };
  const stream: CoreReplyStream = {
    minIntervalMs: 0, get receipt() { return receipt; }, get confirmed() { return confirmed; },
    update: () => {},
    finish: async (snapshot) => {
      for (const [index, message] of snapshot.messages.entries()) {
        confirmed.push({ key: `${id}/${index}`, segments: message.segments.map(part => part.value), message: { conversation: {} as never, id: `${id}-${index}` } });
      }
      receipt = { status: 'sent', message: { conversation: {} as never, id: `${id}-0` } } as never;
      return receipt;
    },
    cancel: async () => receipt,
  };
  return stream;
}

/** The turn engine's answer-phase owner: streamed phases settle through deliverProgressiveReply. */
function phaseLifecycle(turnId: string) {
  const sent: (readonly AgentOutputElement[])[] = [];
  const reply = {
    send: async (elements: readonly AgentOutputElement[]) => { sent.push(elements); return { status: 'sent' as const, messageId: `${turnId}-tail`, messages: [] }; },
  };
  let sequence = 0;
  const openPhase = () => { const id = `${turnId}:answer:${++sequence}`; return { id, stream: confirmingStream(id) }; };
  // Like the turn engine: the first phase is opened up front and handed out by the first open().
  const first = openPhase();
  let firstAvailable = true;
  const lifecycle: ReplyPhaseLifecycle = {
    open: () => { if (firstAvailable) { firstAvailable = false; return first; } return openPhase(); },
    settle: async (phase): Promise<ReplyPhaseFacts> => {
      if (!phase.run) {
        const delivery = await reply.send(phase.output);
        return { delivery, confirmedOutput: [...phase.output], messageId: delivery.messageId };
      }
      const { delivery, confirmedOutput } = await deliverProgressiveReply({ run: phase.run, snapshot: phase.snapshot }, phase.output, reply as never);
      return { delivery, confirmedOutput, ...(delivery.status === 'sent' && delivery.messageId ? { messageId: delivery.messageId } : {}) };
    },
  };
  return { lifecycle, sent, stream: first.stream };
}

describe('#1250 batch 29 review: streamed replies never keep voice base64', () => {
  it('drops a copied inline voice from the stream, keeps the tool voice once, and stores no base64 in history', async () => {
    const trace = new TurnTraceCollector({ turnId: 'voice-1', sessionKey: 'session' });
    const unregister = registerTurnTrace(trace);
    const { stream, snapshots } = replyStream();
    const s = session();
    const copied = { type: 'audio', data: { media: { kind: 'base64', value: AUDIO.slice(0, 4000) } } };
    const first = await s.turn([
      () => assistantToolCallReply([{ id: 'tts', name: 'voice_tts', arguments: { text: '你好' } }]),
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]),
      async (_context, opts) => {
        opts?.onTextDelta?.(structured([{ type: 'text', data: { text: '好的' } }, copied]));
        await new Promise(resolve => setTimeout(resolve, 20));
        return assistantTextReply(structured([{ type: 'text', data: { text: '好的' } }, copied]));
      },
    ], stream, 'voice-1');
    unregister();
    expect(first.executeTool).toHaveBeenCalledTimes(1);
    // The model saw metadata only.
    expect(s.calls[1]).toContain('语音已发送给用户');
    expect(s.calls.join('\n')).not.toContain(AUDIO.slice(0, 64));
    // The stream never offered the copy.
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.messages.flatMap(message => message.segments.map(part => part.value.type))).not.toContain('audio');
    }
    expect(trace.snapshot().timeline.some(entry => entry.kind === 'copied_inline_media_dropped')).toBe(true);
    // Delivered: the text and the tool's voice, once.
    const output = first.result.output ?? [];
    expect(output.filter(element => element.type === 'audio')).toHaveLength(1);
    await first.result.projectConversation?.({ confirmedOutput: output });
    const history = JSON.stringify(s.persisted);
    expect(history).not.toContain(AUDIO.slice(0, 64));
    expect(history).toContain('[语音 mp3 18.6KB 已发送]');

    // Turn 2 loads that history: the model still sees no base64.
    const second = replyStream();
    await s.turn([
      () => assistantTextReply(structured([{ type: 'text', data: { text: '还在' } }])),
    ], second.stream, 'voice-2');
    expect(s.calls.at(-1)).toContain('已发送');
    expect(s.calls.at(-1)).not.toContain(AUDIO.slice(0, 64));
  });
});

describe('#1250 batch 29 review: history never keeps model-written inline media', () => {
  it('non-progressive reply: an inline audio the model wrote is stored as a placeholder only', async () => {
    const s = session();
    const copied = { type: 'audio', data: { media: { kind: 'base64', value: AUDIO.slice(0, 4000) } } };
    const first = await s.turn([
      () => assistantToolCallReply([{ id: 'tts', name: 'voice_tts', arguments: { text: '你好' } }]),
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]),
      () => assistantTextReply(structured([{ type: 'text', data: { text: '好的' } }, copied])),
    ], undefined, 'plain-1');
    expect(first.result.progressive).toBeUndefined();
    // Outbound dedup: the tool's voice once, the copy dropped.
    const output = first.result.output ?? [];
    expect(output.filter(element => element.type === 'audio')).toHaveLength(1);
    expect(JSON.stringify(output.filter(element => element.type === 'message'))).not.toContain(AUDIO.slice(0, 64));
    // The non-progressive engine path projects with a message id only (no confirmedOutput).
    await first.result.projectConversation?.({ messageId: 'sent-1' });
    const history = JSON.stringify(s.persisted);
    expect(history).toContain('好的');
    expect(history).not.toContain(AUDIO.slice(0, 64));
    expect(history).toContain('[已省略 base64 数据（4000 字符），未提供给模型]');

    await s.turn([() => assistantTextReply(structured([{ type: 'text', data: { text: '还在' } }]))], undefined, 'plain-2');
    expect(s.calls.at(-1)).toContain('[已省略 base64 数据');
    expect(s.calls.at(-1)).not.toContain(AUDIO.slice(0, 64));
  });

  it('streamed reply phases: deliverProgressiveReply → stream.confirmed → settlePhase keeps only placeholders', async () => {
    const s = session();
    // The tool's real voice (sent as a tail element) and an inline voice the model invented
    // (no tool produced it, so the stream offers it and the platform confirms it).
    const invented = { type: 'audio', data: { media: { kind: 'base64', value: AUDIO.slice(0, 4000) } } };
    const phases = phaseLifecycle('phase-1');
    const first = await s.turn([
      () => assistantToolCallReply([{ id: 'tts', name: 'voice_tts', arguments: { text: '你好' } }]),
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]),
      async (_context, opts) => {
        opts?.onTextDelta?.(structured([{ type: 'text', data: { text: '好的' } }]));
        await new Promise(resolve => setTimeout(resolve, 20));
        return assistantTextReply(structured([{ type: 'text', data: { text: '好的' } }]));
      },
    ], phases.stream, 'phase-1', phases.lifecycle);
    // The real voice went out once, through the reply port, after the stream settled.
    expect(phases.sent.flat().filter(element => element.type === 'audio')).toHaveLength(1);
    // Phase path: the engine projects with no delivery (phase facts are authoritative).
    await first.result.projectConversation?.(undefined);
    let history = JSON.stringify(s.persisted);
    expect(history).toContain('好的');
    expect(history).toContain('[语音 mp3 18.6KB 已发送]');
    expect(history).not.toContain(AUDIO.slice(0, 64));

    const second = phaseLifecycle('phase-2');
    const turnTwoStart = s.calls.length;
    const next = await s.turn([
      () => assistantToolCallReply([{ id: 'ready-2', name: 'prepare_reply', arguments: {} }]),
      async (_context, opts) => {
        const body = structured([{ type: 'text', data: { text: '再听一次' } }, invented]);
        opts?.onTextDelta?.(body);
        await new Promise(resolve => setTimeout(resolve, 20));
        return assistantTextReply(body);
      },
    ], second.stream, 'phase-2', second.lifecycle);
    // The second turn's model input carries the first turn's placeholder, never the payload.
    expect(s.calls).toHaveLength(turnTwoStart + 2);
    for (const call of s.calls.slice(turnTwoStart)) {
      expect(call).toContain('[语音 mp3 18.6KB 已发送]');
      expect(call).not.toContain(AUDIO.slice(0, 64));
    }
    // The invented voice was streamed and confirmed by the platform.
    expect(JSON.stringify(second.stream.confirmed)).toContain(AUDIO.slice(0, 64));
    await next.result.projectConversation?.(undefined);
    history = JSON.stringify(s.persisted);
    expect(history).toContain('再听一次');
    expect(history).toContain('[语音 2.9KB 已发送]');
    expect(history).not.toContain(AUDIO.slice(0, 64));
  });
});

describe('#1250 batch 29 review: rejected or earlier assistant text goes back to the model without base64', () => {
  it('schema repair: the correction prompt carries a placeholder, never the rejected reply\'s base64', async () => {
    const s = session();
    // `mime_type` is not in the media schema: strict and lenient decoding both reject the reply.
    const invalid = structured([{ type: 'text', data: { text: '听听这个' } },
      { type: 'audio', data: { media: { kind: 'base64', value: AUDIO.slice(0, 4000), mime_type: 'audio/mpeg' } } }]);
    const first = await s.turn([
      () => assistantTextReply(invalid),
      () => assistantTextReply(structured([{ type: 'text', data: { text: '听听这个' } }])),
    ], undefined, 'repair-1');
    expect(s.calls).toHaveLength(2);
    const correction = s.calls[1]!;
    expect(correction).toContain('Rejected reply:');
    expect(correction).toContain('[已省略 base64 数据（4000 字符），未提供给模型]');
    expect(correction).not.toContain(AUDIO.slice(0, 64));
    expect(JSON.stringify(first.result.output)).toContain('听听这个');
    await first.result.projectConversation?.({ messageId: 'sent-1' });
    expect(JSON.stringify(s.persisted)).not.toContain(AUDIO.slice(0, 64));
  });

  it('agent loop: base64 the model wrote beside a tool call is not re-sent on the next iteration', async () => {
    const s = session();
    await s.turn([
      () => assistantToolCallReply([{ id: 'tts', name: 'voice_tts', arguments: { text: '你好' } }], `先发一段 data:audio/mpeg;base64,${AUDIO.slice(0, 4000)}`),
      () => assistantToolCallReply([{ id: 'ready', name: 'prepare_reply', arguments: {} }]),
      () => assistantTextReply(structured([{ type: 'text', data: { text: '好的' } }])),
    ], undefined, 'loop-1');
    expect(s.calls).toHaveLength(3);
    for (const call of s.calls.slice(1)) {
      expect(call).toContain('[已省略 内嵌 audio/mpeg 数据（4000 字符），未提供给模型]');
      expect(call).not.toContain(AUDIO.slice(0, 64));
    }
  });
});

describe('encodeConfirmedOutput / appendConversationBatches', () => {
  it('stores placeholders for inline media elements and segments, never the payload', async () => {
    const confirmedOutput = [
      { type: 'message' as const, segments: [{ type: 'text', data: { text: '好的' } },
        { type: 'audio', data: { media: { kind: 'base64', value: AUDIO } } },
        { type: 'image', data: { media: { kind: 'url', value: `data:image/png;base64,${AUDIO}` } } },
        { type: 'image', data: { media: { kind: 'url', value: 'https://images.example/a.png' } } }] },
      { type: 'audio' as const, url: `data:audio/mpeg;base64,${AUDIO}`, base64: AUDIO },
      { type: 'image' as const, url: `data:image/png;base64,${AUDIO}` },
    ];
    const encoded = encodeConfirmedOutput(confirmedOutput as never);
    expect(encoded).not.toContain(AUDIO.slice(0, 64));
    expect(encoded).toContain('https://images.example/a.png');
    expect(encoded).toContain('[语音 18.6KB 已发送]');
    expect(encoded).toContain('[语音（内嵌数据，已省略）]');
    expect(encoded).toContain('[图片（内嵌数据，已省略）]');

    const persisted: AgentMessage[] = [];
    await appendConversationBatches({
      loadContext: async () => ({ messages: [] }),
      appendMessages: async (_id: string, messages: AgentMessage[]) => { persisted.push(...messages); },
    } as never, 'session', [{
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'draft' }], api: 'x', provider: 'p', model: 'm', usage: {} as never, stopReason: 'stop', timestamp: 0 } as AgentMessage],
      messageExtras: [undefined],
    } as never], { confirmedOutput: confirmedOutput as never });
    const history = JSON.stringify(persisted);
    expect(history).toContain('好的');
    expect(history).not.toContain(AUDIO.slice(0, 64));
  });
});
