import { RED_CIRCLE_PNG } from '../../evals/fixtures/images.js';
import { describe, expect, it, vi } from 'vitest';
import { aiOutboundJsonSchema } from '@zhin.js/core';
import type { AgentMessage, AgentTool, StreamOptions } from '@zhin.js/ai';
import { decodeStructuredReply } from '../../src/outbound/structured-reply.js';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import { renderAgentOutput } from '../../src/outbound/agent-output.js';
import { OutboundLeakInspector, guardReplyPort } from '../../src/security/outbound-leak-guard.js';
import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

vi.mock('../../src/prompt/assembly.js', () => ({
  buildAgentPathSystemPrompt: async () => 'system',
  buildChatPathSystemPrompt: () => 'system',
  describeAgentPathPromptSections: async () => [],
}));
const { runAgentLoopTextTurnRun, collectAgentLoopTurnRun } = await import('../../src/core/agent-core-run.js');

const text = (value: string) => ({ type: 'text', data: { text: value } });
const mention = (id: string) => ({ type: 'mention', data: { target: id } });

async function run(responses: ReturnType<typeof assistantTextReply>[], options: {
  tools?: AgentTool[];
  maxIterations?: number;
  outputSchema?: false | Record<string, unknown>;
  detached?: boolean;
} = {}) {
  const llm = wireMockLlmApi({ models: ['m'], responder: () => responses.shift()! });
  const streamOptions: (StreamOptions | undefined)[] = [];
  const original = llm.runtime.stream.bind(llm.runtime);
  vi.spyOn(llm.runtime, 'stream').mockImplementation((model, context, opts) => {
    streamOptions.push(opts);
    return original(model, context, opts);
  });
  const host = {
    contextRepository: {
      loadContext: async () => ({ messages: [] }),
      appendMessages: async () => {},
    },
    getTurnProvider: () => ({ name: 'mock' }),
    llmRuntime: llm.runtime,
    config: { maxIterations: options.maxIterations ?? 3, outputSchema: options.outputSchema,
      toolExecution: 'sequential', compaction: {}, contextTokens: 100_000,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined,
    promptTraceConfig: {}, phaseConfig: {},
  };
  const events: TurnEvent[] = [];
  const chunks: string[] = [];
  const tools = options.tools ?? [];
  const result = await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host: host as never, sessionId: 's', rawContent: '请 @ Alice 提醒她',
    promptProfile: { kind: 'interactive' },
    turnContext: {
      origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
      principal: { subjectId: '123', roles: ['user'] }, session: { key: 's' },
    },
    allTools: tools, resolvedTools: tools,
    toolExecution: { execute: async () => ({ status: 'completed', output: { id: '456', name: 'Alice' }, durationMs: 1 }) } as never,
    personaEnhanced: '', modelId: 'm', modelCandidates: ['m'], toolLoading: 'direct',
    conversationPersistence: options.detached ? 'none' : 'session',
    onChunk: chunk => { chunks.push(chunk); },
  }), event => { events.push(event); });
  return { result, events, chunks, calls: llm.calls, streamOptions };
}

describe('structured Agent final replies', () => {
  it('keeps media capability and size policies on structured messages', async () => {
    const output = decodeStructuredReply(JSON.stringify({ segments: [mention('123'),
      { type: 'image', data: { media: { kind: 'base64', value: RED_CIRCLE_PNG.base64 } } }] }));
    const caps = { image: false, audio: false, video: false, file: false };
    expect(await publishOutboundElements(output, 'icqq', caps)).toEqual([mention('123'), text('[image]')]);
    const limited = await publishOutboundElements(output, 'icqq', { ...caps, image: true, maxAttachmentBytes: 1 });
    expect(limited[0]).toEqual(mention('123'));
    const valid = await publishOutboundElements(output, 'icqq', { ...caps, image: true });
    expect(valid[1]).toMatchObject({ type: 'image', data: { media: {
      kind: 'base64', value: RED_CIRCLE_PNG.base64, mime_type: 'image/png',
    } } });
    expect(limited[1]).toMatchObject({ type: 'text', data: { text: expect.stringContaining('大小限制') } });
  });

  it('keeps text, mentions and media ordered from the model through the terminal to the send port', async () => {
    const segments = [{ type: 'markdown', data: { content: '**提醒**' } }, text('请 '), mention('123'), text(' 和 '), mention('456'),
      text(' 看图'), { type: 'image', data: { media: { kind: 'file', value: 'platform-image-ref' } } }];
    const { result, events, chunks, streamOptions } = await run([assistantTextReply(JSON.stringify({ segments }))]);
    expect(streamOptions[0]?.outputSchema).toEqual(aiOutboundJsonSchema);
    const terminal = events.find(e => e.type === 'turn_end');
    expect(terminal).toMatchObject({ output: result.output });
    expect(await publishOutboundElements(result.output!, 'icqq')).toEqual(segments);
    expect(result.reply).toBe('**提醒**请 @123 和 @456 看图[image]');
    expect(chunks).toEqual([result.reply]);
    expect(events.filter(e => e.type === 'chunk')).toEqual([{ type: 'chunk', text: result.reply, accumulated: result.reply }]);
  });

  it('supports a normal text reply and intentional silence with the same schema', async () => {
    const normal = await run([assistantTextReply(JSON.stringify({ segments: [text('你好')] }))]);
    expect(normal.result.reply).toBe('你好');
    const silent = await run([assistantTextReply('{"segments":[]}')]);
    expect(silent.result.output).toEqual([]);
    expect(silent.result.reply).toBe('');
  });

  it('allows a member lookup tool before the final message and uses its returned ID', async () => {
    const lookup = { name: 'member_lookup', description: 'Find a member', parameters: { type: 'object', properties: {} } } as AgentTool;
    const { result, events, calls } = await run([
      assistantToolCallReply([{ id: 'lookup', name: 'member_lookup', arguments: {} }]),
      assistantTextReply(JSON.stringify({ segments: [mention('456'), text('，请查收')] })),
    ], { tools: [lookup] });
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
    expect(JSON.stringify(calls[1].context.messages)).toContain('456');
    expect(await publishOutboundElements(result.output!)).toEqual([mention('456'), text('，请查收')]);
    expect(calls[0].context.systemPrompt).toContain('ask for clarification');
    expect(calls[0].context.systemPrompt).not.toContain('pipelineRole');
  });

  it.each([
    JSON.stringify('{"segments":[]}'), 'not JSON', '```json\n{"segments":[]}\n```', '{"text":"hello"}',
    '{"segments":[{"type":"mention","data":{}}]}',
    '{"segments":[{"type":"text","data":{"text":"valid"}},{"type":"mention","data":{"target":123}}]}',
    '{"segments":[],"mentions":["Alice"]}',
    '{"segments":[{"type":"markdown","data":{"text":"wrong field"}}]}',
  ])('rejects malformed output atomically: %s', async raw => {
    expect(() => decodeStructuredReply(raw)).toThrow();
    await expect(run([assistantTextReply(raw)])).rejects.toThrow('Agent final reply');
  });

  it('masks Markdown and nested segment strings without changing mention order', async () => {
    const sent: unknown[] = [];
    const port = guardReplyPort({ send: async output => {
      sent.push(await publishOutboundElements(output)); return { status: 'sent' };
    } }, new OutboundLeakInspector({ secretValues: ['secret-1234567890'] }));
    const output = decodeStructuredReply(JSON.stringify({ segments: [mention('123'), { type: 'markdown', data: { content: 'secret-1234567890' } }, { type: 'share', data: { title: 'secret-1234567890', url: 'https://example.com' } }] }));
    await port.send(output);
    expect(sent).toEqual([[mention('123'), { type: 'markdown', data: { content: '[已隐藏：密钥]' } }, { type: 'share', data: { title: '[已隐藏：密钥]', url: 'https://example.com' } }]]);
    expect(renderAgentOutput(output)).toContain('secret-1234567890'); // input was not mutated
  });

  it('keeps detached turns and explicit text mode outside the IM preset', async () => {
    for (const options of [{ detached: true }, { outputSchema: false as const }]) {
      const { result, streamOptions, calls } = await run([assistantTextReply('plain')], options);
      expect(result.reply).toBe('plain');
      expect(streamOptions[0]?.outputSchema).toBeUndefined();
      expect(calls[0].context.systemPrompt).not.toContain('"segments"');
    }
  });

  it('keeps custom schemas separate from the IM prompt', async () => {
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const { streamOptions, calls } = await run([assistantTextReply('{"answer":"ok"}')], { outputSchema: schema });
    expect(streamOptions[0]?.outputSchema).toEqual(schema);
    expect(calls[0].context.systemPrompt).not.toContain('"segments"');
  });

  it.each(['', '我先查一下成员信息'])('applies the same schema to tools-off recovery with preamble %j', async preamble => {
    const lookup = { name: 'member_lookup', description: 'Find member', parameters: { type: 'object', properties: {} } } as AgentTool;
    const { result, calls, streamOptions } = await run([
      assistantToolCallReply([{ id: 'lookup', name: 'member_lookup', arguments: {} }], preamble),
      assistantTextReply(JSON.stringify({ segments: [mention('456'), text('，找到你了')] })),
    ], { tools: [lookup], maxIterations: 1 });
    expect(calls).toHaveLength(2);
    expect(streamOptions.every(options => options?.outputSchema === aiOutboundJsonSchema)).toBe(true);
    expect(result.reply).toBe('@456，找到你了');
  });
});
