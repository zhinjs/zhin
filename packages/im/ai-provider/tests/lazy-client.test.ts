import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '@zhin.js/ai';
import { OwnedLanguageRun, type InferenceClient } from '@zhin.js/ai/provider';
import { createLazyInferenceClient } from '../src/lazy-client.js';
import type { InferenceUsageAccounting } from '../src/usage.js';

const request = { context: { messages: [] } };
function reply(total = 3, reported?: AssistantMessage['usage']['reported']): AssistantMessage {
  return { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'ok' }], provider: 'fixture', model: 'native', api: 'fixture',
    stopReason: 'stop', usage: { ...EMPTY_TOKEN_USAGE, input: total, totalTokens: total, reported } };
}
function fixture(message = reply()) {
  const close = vi.fn(async () => {}), streamClose = vi.fn(async () => {}), generate = vi.fn(async () => message);
  const finish = vi.fn(), invocationClose = vi.fn(), begin = vi.fn(() => ({ run: <T>(fn: () => Promise<T>) => fn(), finish, close: invocationClose }));
  const accounting: InferenceUsageAccounting = { begin, submitted() {} };
  const underlying: InferenceClient = { list: async () => [], generate, generateImage: async () => ({ base64: 'YQ==', mimeType: 'image/png', model: 'native' }),
    evaluate: async () => { throw new Error('unused'); },
    stream: async () => new OwnedLanguageRun({ controller: new AbortController(), release: streamClose, project: event => event, onCleanupError() {},
      source: (async function* () { yield { type: 'text_delta' as const, text: 'ok' }; yield { type: 'done' as const, message }; })() }),
    close, [Symbol.asyncDispose]: close };
  const open = vi.fn(async () => underlying), controller = new AbortController();
  const client = createLazyInferenceClient({ signal: controller.signal, open, accounting });
  return { client, controller, open, close, streamClose, generate, begin, finish, invocationClose, underlying };
}

it('does not open or account for construction, an unconsumed stream, or unused close', async () => {
  const item = fixture();
  const run = await item.client.stream({ request });
  expect(item.open).not.toHaveBeenCalled(); expect(item.begin).not.toHaveBeenCalled();
  await run.close(); await item.client.close(); await item.client.close();
  expect(item.open).not.toHaveBeenCalled(); expect(item.close).not.toHaveBeenCalled();
  expect(item.begin).not.toHaveBeenCalled();
});

it('opens once for concurrent calls and closes its own client exactly once', async () => {
  const item = fixture();
  expect(await Promise.all([item.client.generate({ request }), item.client.generate({ request })])).toHaveLength(2);
  expect(item.open).toHaveBeenCalledTimes(1); expect(item.generate).toHaveBeenCalledTimes(2);
  expect(item.finish).toHaveBeenCalledTimes(2); expect(item.invocationClose).toHaveBeenCalledTimes(2);
  await item.client.close(); await item.client.close(); expect(item.close).toHaveBeenCalledTimes(1);
  await expect(item.client.generate({ request })).rejects.toThrow('operation-closed');
});

it('lists without a usage admission or bill', async () => {
  const item = fixture(); await item.client.list({ kind: 'language' });
  expect(item.open).toHaveBeenCalledTimes(1); expect(item.begin).not.toHaveBeenCalled(); await item.client.close();
});

it.each([{ reported: { totalTokens: false, input: false, output: false }, expected: undefined },
  { reported: undefined, expected: undefined },
  { reported: { totalTokens: true }, expected: 0 }, { reported: { input: true, output: true }, expected: 0 }])(
  'distinguishes missing usage from reported zero: $reported', async ({ reported, expected }) => {
    const item = fixture(reply(0, reported)); await item.client.generate({ request });
    expect(item.finish.mock.calls[0]![0]).toEqual({ text: 'ok', ...(expected !== undefined ? { totalTokens: expected } : {}) });
    await item.client.close();
  });

it('stream break releases the independent run, then closing releases its client', async () => {
  const item = fixture(), run = await item.client.stream({ request });
  for await (const event of run) { expect(event.type).toBe('text_delta'); break; }
  expect(item.streamClose).toHaveBeenCalledTimes(1); expect(item.finish).not.toHaveBeenCalled();
  expect(item.invocationClose).toHaveBeenCalledTimes(1); expect(item.close).not.toHaveBeenCalled();
  await item.client.close(); expect(item.close).toHaveBeenCalledTimes(1);
});

it('settles a consumed stream once and releases on source end', async () => {
  const item = fixture(), run = await item.client.stream({ request });
  const events = []; for await (const event of run) events.push(event);
  expect(events.map(event => event.type)).toEqual(['text_delta', 'done']);
  expect(item.finish).toHaveBeenCalledExactlyOnceWith({ totalTokens: 3, text: 'ok' });
  expect(item.streamClose).toHaveBeenCalledTimes(1); await item.client.close();
});

it('does not turn settlement or close diagnostic failures into a failed successful inference', async () => {
  const item = fixture(); item.finish.mockImplementation(() => { throw new Error('settlement'); });
  item.close.mockRejectedValue(new Error('cleanup'));
  await expect(item.client.generate({ request })).resolves.toMatchObject({ content: [{ text: 'ok' }] });
  await expect(item.client.close()).resolves.toBeUndefined(); expect(item.generate).toHaveBeenCalledTimes(1);
});

it('closes a client arriving after operation cancellation without publishing it', async () => {
  const item = fixture(); let resolve!: (client: InferenceClient) => void;
  const gate = new Promise<InferenceClient>(done => { resolve = done; });
  const open = vi.fn(() => gate), controller = new AbortController();
  const client = createLazyInferenceClient({ signal: controller.signal, open });
  const operation = client.generate({ request });
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1)); controller.abort(); resolve(item.underlying);
  await expect(operation).rejects.toThrow('operation-closed'); await client.close();
  expect(item.close).toHaveBeenCalledTimes(1); expect(item.generate).not.toHaveBeenCalled();
});
