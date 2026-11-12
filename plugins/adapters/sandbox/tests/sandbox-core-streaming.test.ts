import WebSocket from 'ws';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, projectLocaleToken, type SnapshotState } from 'zhin.js';
import { ImRuntime, type CoreReplyStream, type ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { httpHostToken } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import sandboxAdapter from '../adapters/sandbox/index.js';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

it('preserves streamed Markdown through the actual Sandbox declaration, Core projection, native wire and history', async () => {
  const root = rootPluginId(), abort = new AbortController(), events = new MemoryConversationEventStore();
  const im = new ImRuntime({ conversationEvents: events });
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox',
    source: '/fixture/adapters/sandbox/index.ts', definition: sandboxAdapter });
  const state: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { id: 'stream-bot', owner: 'stream-owner' }]]),
    resources: new Map([[root, new Map([[httpHostToken.id, http], [endpointEventGatewayToken.id, im.endpointEvents], [projectLocaleToken.id, 'zh-CN']])]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  };
  const adapters = await AdapterIndex.create([slot], createSnapshotView(0, state), abort.signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, adapters]]) });
  im.attach(snapshots);
  const target = { endpoint: { adapter: 'sandbox', id: String(slot.id) }, kind: 'private' as const, id: 'stream-owner' };
  const frames: Record<string, unknown>[] = [];
  let socket: WebSocket | undefined;
  let operation: ReturnType<typeof im.endpoints.captureOperation> | undefined;
  let stream: CoreReplyStream | undefined;
  const snapshot = (text: string, revision: number, complete: boolean): ReplyStreamSnapshot => ({ revision,
    messages: [{ key: 'answer', complete, segments: [{ key: 'body', complete, value: { type: 'markdown', data: { content: text } } }] }],
  });
  try {
    await adapters.start(); adapters.open();
    const { port } = await http.listen();
    socket = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    socket.on('message', raw => frames.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    socket.send(JSON.stringify({ op: 'subscribe', conversation: { type: 'private', id: target.id } }));
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
    operation = im.endpoints.captureOperation({ target, client: adapters.client('sandbox', String(slot.id)) });
    stream = operation.openReplyStream!()!;
    const before = '## Streaming\n\n**first';
    stream.update(snapshot(before, 1, false));
    await vi.waitFor(() => expect(frames.some(frame => frame.revision === 1)).toBe(true));
    const first = frames.find(frame => frame.revision === 1)!;
    expect(first.content).toEqual([{ type: 'markdown', data: { content: before } }]);
    const full = `${before} complete**\n\n\`\`\`typescript\nconst value = 1;\n\`\`\``;
    expect(await stream.finish(snapshot(full, 2, true))).toMatchObject({ status: 'sent', message: { id: first.messageId } });
    await vi.waitFor(() => expect(frames.some(frame => frame.revision === 2)).toBe(true));
    const final = frames.find(frame => frame.revision === 2)!;
    expect(final).toMatchObject({ messageId: first.messageId, streaming: false });
    expect(final.content).toEqual([{ type: 'markdown', data: { content: full } }]);
    const history = await events.listMessages(target, undefined, 50);
    expect(history).toHaveLength(1);
    expect(history[0]!.message.segments).toEqual(final.content);
  } finally {
    await stream?.cancel(); operation?.release(); socket?.terminate();
    abort.abort(); await adapters.stop(); await snapshots.close(); await http.close();
  }
});
