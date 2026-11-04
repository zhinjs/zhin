import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@zhin.js/ai';
import { LocalImageAssetStore, type LocalImageScope } from '../../src/media/local-image-assets.js';
import { LocalImageInspection } from '../../src/media/local-image-inspection.js';
import { runAgentLoopStandaloneTurn } from '../../src/core/agent-loop-standalone.js';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';
import type { MediaPerceptionPort } from '../../src/media/perception.js';

const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const scope: LocalImageScope = { origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
  principal: { subjectId: 'alice', roles: [] }, sessionKey: 'g' };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-image-inspection-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it.each([[true, false], [false, false], [true, true]])('inspects only on demand and respects output replacement (vision=%s, hidden=%s)', async (vision, hidden) => {
  const store = new LocalImageAssetStore(directory);
  const callbacks = { onToolResult: vi.fn() };
  const requests: Context[] = [];
  let step = 0;
  const llm = wireMockLlmApi({ responder: context => {
    requests.push(JSON.parse(JSON.stringify(context)) as Context);
    step++;
    if (step === 1) return assistantToolCallReply([{ id: 'capture', name: 'screenshot', arguments: {} }]);
    if (step === 2) {
      const asset = JSON.stringify(context.messages).match(/asset_id[^a-f0-9]+([a-f0-9-]{36})/u)?.[1];
      expect(asset).toBeTruthy();
      expect(JSON.stringify(context)).not.toContain(image);
      return assistantToolCallReply([{ id: 'inspect', name: 'get_local_assets', arguments: { asset_id: asset } }]);
    }
    if (step === 3) return assistantToolCallReply([{ id: 'later', name: 'noop', arguments: {} }]);
    return assistantTextReply('Done');
  } });
  const model = { ...llm.runtime.model('mock', 'mock-model'), input: vision ? ['text', 'image'] as const : ['text'] as const };
  vi.spyOn(llm.runtime, 'model').mockReturnValue(model);
  const perception: MediaPerceptionPort = { kinds: ['image'], maxItemsPerTurn: 4, accepts: () => true,
    describe: vi.fn(async () => ({ text: 'A tiny private image.', provider: 'vision', model: 'vision-model',
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })) };
  const result = await runAgentLoopStandaloneTurn({ provider: llm.provider, llmRuntime: llm.runtime, model: 'mock-model',
    systemPrompt: '', userInput: 'Inspect the screenshot', maxIterations: 5, localAssets: store, localAssetScope: scope,
    mediaPerception: perception, callbacks,
    ...(hidden ? { transformToolResult: ({ toolName, result }: { toolName: string; result: unknown }) =>
      toolName === 'get_local_assets' ? 'Image hidden by output policy' : result } : {}),
    tools: [
      { name: 'screenshot', description: 'Capture', source: 'mcp:browser', kind: 'mcp', parameters: {},
        execute: async () => ({ content: [{ type: 'image', data: image, mimeType: 'image/gif' }] }) },
      { name: 'noop', description: 'Continue', parameters: {}, execute: async () => 'ok' },
    ],
  });
  expect(requests, JSON.stringify(result)).toHaveLength(4);
  expect(JSON.stringify(requests[2])).toContain(hidden ? 'Image hidden by output policy' : vision ? image : 'A tiny private image.');
  const transient = requests[2].messages.at(-1);
  if (vision && !hidden) expect(transient).toMatchObject({ role: 'user', media: [{ type: 'image' }] });
  if (hidden) expect(JSON.stringify(requests[2])).not.toContain(image);
  expect(JSON.stringify(requests[3])).not.toContain(image);
  expect(JSON.stringify(result)).not.toContain(image);
  expect(JSON.stringify(callbacks.onToolResult.mock.calls)).not.toContain(image);
  expect(perception.describe).toHaveBeenCalledTimes(vision ? 0 : 1);
  expect(result.usage.total_tokens).toBe(vision ? 0 : 12);
});

it('rejects forged inspection results and shares the inspection limit with child turns', async () => {
  const store = new LocalImageAssetStore(directory);
  const ref = await store.capture(image, scope, 'screenshot');
  const budget = { remaining: 1 };
  const parent = new LocalImageInspection(store, scope, budget);
  const child = new LocalImageInspection(store, { ...scope, sessionKey: 'g#subagent' }, budget);
  expect(parent.accept(ref)).toBeUndefined();
  expect(parent.accept(await store.inspect(ref.asset_id, scope))).toContain('inspection requested');
  expect(child.accept(await store.inspect(ref.asset_id, scope))).toContain('limit reached');
  const llm = wireMockLlmApi();
  const context: Context = { messages: [] };
  await parent.wrap(llm.runtime).complete({ ...llm.runtime.model('mock', 'mock-model'), input: ['text'] }, context);
  expect(JSON.stringify(llm.calls[0].context)).toContain('no configured vision capability');
  expect(context.messages).toEqual([]);
});

it.each([true, false])('projects repeated reads of one private asset once per request (vision=%s)', async vision => {
  const store = new LocalImageAssetStore(directory);
  const asset = await store.capture(image, scope, 'screenshot');
  const budget = { remaining: 4 };
  const onUsage = vi.fn();
  const perception: MediaPerceptionPort = { kinds: ['image'], maxItemsPerTurn: 4, accepts: () => true,
    describe: vi.fn(async () => ({ text: 'A tiny private image.', provider: 'vision', model: 'vision-model',
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })) };
  const inspection = new LocalImageInspection(store, scope, budget, perception, onUsage);
  inspection.accept(await store.inspect(asset.asset_id, scope));
  inspection.accept(await store.inspect(asset.asset_id, scope));
  expect(budget.remaining).toBe(2); // Accepted inspection attempts still consume the existing limit.
  const read = vi.spyOn(store, 'read');
  const llm = wireMockLlmApi();
  const model = { ...llm.runtime.model('mock', 'mock-model'), input: vision ? ['text', 'image'] as const : ['text'] as const };
  const context: Context = { messages: [] };
  const transport = inspection.wrap(llm.runtime);

  await transport.complete(model, context);
  expect(read).toHaveBeenCalledOnce();
  const first = llm.calls[0].context.messages.at(-1);
  if (vision) expect(first).toMatchObject({ media: [{ type: 'image' }] });
  else expect(JSON.stringify(first).match(/A tiny private image\./gu)).toHaveLength(1);
  expect(perception.describe).toHaveBeenCalledTimes(vision ? 0 : 1);
  expect(onUsage).toHaveBeenCalledTimes(vision ? 0 : 1);

  await transport.complete(model, context);
  expect(llm.calls[1].context.messages).toEqual([]);
  inspection.accept(await store.inspect(asset.asset_id, scope));
  await transport.complete(model, context);
  expect(read).toHaveBeenCalledTimes(2); // A later explicit inspection is still allowed.
  expect(perception.describe).toHaveBeenCalledTimes(vision ? 0 : 2);
  expect(budget.remaining).toBe(1);
  expect(context.messages).toEqual([]);
});

it('keeps distinct private resources separate even when their bytes match', async () => {
  const store = new LocalImageAssetStore(directory);
  const first = await store.capture(image, scope, 'first screenshot');
  const second = await store.capture(image, scope, 'second screenshot');
  expect(first.asset_id).not.toBe(second.asset_id);
  const inspection = new LocalImageInspection(store, scope, { remaining: 4 });
  inspection.accept(await store.inspect(first.asset_id, scope));
  inspection.accept(await store.inspect(second.asset_id, scope));
  const llm = wireMockLlmApi();
  await inspection.wrap(llm.runtime).complete({ ...llm.runtime.model('mock', 'mock-model'), input: ['text', 'image'] }, { messages: [] });
  expect(llm.calls[0].context.messages.at(-1)).toMatchObject({ media: [{ type: 'image' }, { type: 'image' }] });
});
