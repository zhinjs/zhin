import { chatFailureLine } from '../../src/outbound/chat-failure.js';

/** IM turns say a format failure in the chat voice (the host notice is for non-chat callers). */
const STRUCTURED_REPLY_FAILURE = chatFailureLine('format', { random: 0 });
import { runEvalCase } from '../../evals/framework/index.js';
import { mapTurnEventToAgentStreamEvents } from '../../src/event/turn-to-agent-stream.js';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import { formatTurnUsageLogs } from '../../src/trace/turn-usage-log.js';

it('keeps trace model calls and total usage aligned with the terminal after an exhausted-turn summary', async () => {
  const result = await runEvalCase({
    id: 'usage-trace-summary', description: 'Trace counts summary usage as an actual model response',
    source: '#821 turn usage must remain observable through the trace',
    inbound: { text: '查询后总结' },
    agentConfig: { maxIterations: 1, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
    tools: [{ name: 'lookup_once', result: 'found' }],
    script: [
      { toolCalls: [{ name: 'lookup_once' }], tokens: 60 },
      { text: '已找到结果。', tokens: 50 },
    ], expect: {},
  });
  const terminal = result.terminals[0];
  expect(terminal.type).toBe('turn_end');
  if (terminal.type !== 'turn_end') throw new Error('Missing terminal');
  expect(terminal.usage.totalTokens).toBe(110);
  expect(result.traces[0].usage.total_tokens).toBe(110);
  expect(result.traces[0].model_calls).toHaveLength(2);
  const logs = formatTurnUsageLogs(result.traces[0], { traceId: 'summary', scene: 'eval/private' });
  expect(logs.summary).toContain('calls: 2');
  expect(logs.summary).toContain(`input: ${terminal.usage.promptTokens}`);
  // The scripted provider defaults output to zero without reporting its availability.
  expect(terminal.usage.completionTokens).toBe(0);
  expect(logs.summary).toContain('output: ?');
  expect(logs.details.filter(line => line.startsWith('call |'))).toHaveLength(2);
  expect(result.traces[0].model_calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ model: expect.any(String), provider: expect.any(String), duration_ms: expect.any(Number) }),
  ]));

});

it('carries a mixed default-schema reply through the full engine, terminal, publisher and Console preview', async () => {
  const segments = [
    { type: 'markdown', data: { content: '**结果**\n' } },
    { type: 'mention', data: { target: 'owner' } },
    { type: 'text', data: { text: '，请查收' } },
    { type: 'image', data: { media: { kind: 'file', value: 'platform-image' } } },
  ];
  const result = await runEvalCase({
    id: 'structured-mixed', description: 'Default IM harness rich reply',
    inbound: { text: '请发 Markdown 说明、图片并 @ 我', sender: { id: 'owner', roles: ['user'] } },
    script: [{ segments }], expect: {},
  });
  const preview = '**结果**\n@owner，请查收[image]';
  expect(result.outbound, JSON.stringify(result.traces)).toEqual([preview]);
  expect(result.modelRequests).toHaveLength(1);
  expect(result.modelRequests[0].inputText).toContain('Sender: id=owner');
  const terminal = result.terminals.find(event => event.type === 'turn_end');
  expect(terminal?.type).toBe('turn_end');
  if (terminal?.type !== 'turn_end') throw new Error('Missing successful terminal');
  expect(await publishOutboundElements(terminal.output, 'icqq')).toEqual(segments);
  const consoleEvents = mapTurnEventToAgentStreamEvents(terminal, { sessionId: 's', turnId: 't' });
  expect(JSON.stringify(consoleEvents)).toContain(JSON.stringify(preview).slice(1, -1));
});

it('fails closed after one format correction without replaying the completed operation', async () => {
  const result = await runEvalCase({
    id: 'structured-invalid-after-tool', description: 'Formatting failure does not replay tools',
    inbound: { text: '做一次查询，然后展示结果' },
    tools: [{ name: 'lookup_once', description: 'Read a result once.', result: { id: '123' } }],
    script: [
      { toolCalls: [{ name: 'lookup_once', args: {} }] },
      { segments: [{ type: 'text', data: { text: 'valid prefix' } }, { type: 'image', data: {} }] },
      { segments: [{ type: 'image', data: {} }] },
    ], expect: {},
  });
  expect(result.modelRequests).toHaveLength(3);
  expect(result.attemptedTools).toEqual(['lookup_once']);
  expect(result.executedTools).toHaveLength(1);
  expect(result.outbound).toEqual([STRUCTURED_REPLY_FAILURE]);
  expect(result.modelRequests[2].offeredTools).toEqual([]);
  expect(result.extraModelRequests).toBe(0);
});
