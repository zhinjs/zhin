import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@zhin.js/ai';
import { LocalImageAssetStore, type LocalImageScope } from '../../src/media/local-image-assets.js';
import { LocalImageInspection } from '../../src/media/local-image-inspection.js';
import { wireMockLlmApi } from '../helpers/mock-llm-api.js';
import type { MediaPerceptionCall, MediaPerceptionPort } from '../../src/media/perception.js';

const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const scope: LocalImageScope = { origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
  principal: { subjectId: 'alice', roles: [] }, sessionKey: 'g' };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-image-inspection-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

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

it('reports every perception request of an inspection, also those in flight when the turn is cancelled (#1250)', async () => {
  const store = new LocalImageAssetStore(directory);
  const asset = await store.capture(image, scope, 'screenshot');
  const controller = new AbortController();
  const estimate = { prompt_tokens: 1_050, completion_tokens: 0, total_tokens: 1_050 };
  const perception: MediaPerceptionPort = { kinds: ['image'], maxItemsPerTurn: 4, accepts: () => true,
    describe: async (_payload, _signal, observe) => {
      observe?.({ provider: 'svc-a', model: 'primary', status: 'failed', usage: estimate, usageReported: false, durationMs: 3 });
      controller.abort(new Error('stopped'));
      observe?.({ provider: 'svc-b', model: 'backup', status: 'cancelled', usage: estimate, usageReported: false, durationMs: 1 });
      throw new Error('aborted');
    } };
  const calls: MediaPerceptionCall[] = [];
  const inspection = new LocalImageInspection(store, scope, { remaining: 4 }, perception, call => calls.push(call));
  inspection.accept(await store.inspect(asset.asset_id, scope));
  const llm = wireMockLlmApi();
  const model = { ...llm.runtime.model('mock', 'mock-model'), input: ['text'] as const };
  await expect(inspection.wrap(llm.runtime).complete(model, { messages: [] }, { signal: controller.signal })).rejects.toThrow();
  expect(calls.map(call => [call.provider, call.status])).toEqual([['svc-a', 'failed'], ['svc-b', 'cancelled']]);
});

it('counts a fresh description from a port that reports no requests as one call, and a cache hit as none (#1250)', async () => {
  const store = new LocalImageAssetStore(directory);
  const asset = await store.capture(image, scope, 'screenshot');
  let cached = false;
  const perception: MediaPerceptionPort = { kinds: ['image'], maxItemsPerTurn: 4, accepts: () => true,
    describe: async () => {
      const result = { text: 'A dot.', provider: 'svc', model: 'm', cached };
      cached = true;
      return result;
    } };
  const calls: MediaPerceptionCall[] = [];
  const inspection = new LocalImageInspection(store, scope, { remaining: 4 }, perception, call => calls.push(call));
  const llm = wireMockLlmApi();
  const model = { ...llm.runtime.model('mock', 'mock-model'), input: ['text'] as const };
  const transport = inspection.wrap(llm.runtime);
  inspection.accept(await store.inspect(asset.asset_id, scope));
  await transport.complete(model, { messages: [] });
  inspection.accept(await store.inspect(asset.asset_id, scope));
  await transport.complete(model, { messages: [] });
  expect(calls).toEqual([expect.objectContaining({ provider: 'svc', model: 'm', status: 'completed', usageReported: false,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })]);
});
