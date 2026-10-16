import { runEvalCase } from '../../evals/framework/index.js';
import { mapTurnEventToAgentStreamEvents } from '../../src/event/turn-to-agent-stream.js';
import { publishOutboundElements } from '../../src/media/media-publisher.js';

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

it('rejects an invalid rich reply after a tool without retrying the completed operation', async () => {
  const result = await runEvalCase({
    id: 'structured-invalid-after-tool', description: 'Formatting failure does not replay tools',
    inbound: { text: '做一次查询，然后展示结果' },
    tools: [{ name: 'lookup_once', description: 'Read a result once.', result: { id: '123' } }],
    script: [
      { toolCalls: [{ name: 'lookup_once', args: {} }] },
      { segments: [{ type: 'text', data: { text: 'valid prefix' } }, { type: 'image', data: {} }] },
    ], expect: {},
  });
  expect(result.modelRequests).toHaveLength(2);
  expect(result.attemptedTools).toEqual(['lookup_once']);
  expect(result.executedTools).toHaveLength(1);
  expect(result.outbound).toEqual([]);
  expect(result.traces[0]?.termination?.status).toBe('failed');
  expect(result.extraModelRequests).toBe(0);
});
