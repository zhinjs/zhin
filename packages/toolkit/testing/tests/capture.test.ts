import { Readable } from 'node:stream';
import { captureDeliveryValue } from '../src/delivery-capture.js';
import { shouldCopyFixture } from './fixture-copy-filter.mjs';
import { sqliteRuntimeArguments } from './sqlite-runtime.mjs';

it('detaches payload metadata and bytes while preserving live Node/Web stream identities without freezing or draining', async () => {
  const node = Readable.from(['upload']);
  const web = new ReadableStream({ start(controller) { controller.enqueue('web upload'); controller.close(); } });
  const bytes = Buffer.from('bytes');
  const payload = { media: { node, web }, metadata: { title: 'original' }, bytes };
  const capture = captureDeliveryValue(payload);
  payload.metadata.title = 'changed'; bytes.fill(0);
  expect(capture.metadata.title).toBe('original'); expect(capture.bytes.toString()).toBe('bytes');
  expect(Object.isFrozen(capture)).toBe(true); expect(Object.isFrozen(capture.metadata)).toBe(true);
  expect(capture.media.node).toBe(node); expect(capture.media.web).toBe(web);
  expect(Object.isFrozen(node)).toBe(false); expect(Object.isFrozen(web)).toBe(false);
  let content = ''; for await (const part of node) content += String(part);
  expect(content).toBe('upload');
  expect(await web.getReader().read()).toEqual({ done: false, value: 'web upload' });
});

it('captures SDK DTO instances containing streams and preserves repeated byte identities', () => {
  const stream = Readable.from(['sdk-upload']);
  class NativeUpload { data = { stream }; }
  const bytes = Buffer.from('shared');
  const capture = captureDeliveryValue({ native: new NativeUpload(), first: bytes, second: bytes });
  expect(capture.native.data.stream).toBe(stream);
  expect(capture.first).toBe(capture.second);
  expect(capture.first).not.toBe(bytes);
  expect(Object.isFrozen(capture.native.data)).toBe(true);
  stream.destroy();
});

it('retains aliases and cycles in opaque native payload records without recursive freezing failure', () => {
  const shared = { title: 'shared' };
  const payload: { first: typeof shared; second: typeof shared; self?: unknown } = { first: shared, second: shared };
  payload.self = payload;
  const capture = captureDeliveryValue(payload);
  expect(capture).not.toBe(payload); expect(capture.self).toBe(capture); expect(capture.first).toBe(capture.second);
  expect(Object.isFrozen(capture.first)).toBe(true);
});

it.each(['C:\\workspace\\group-suite\\node_modules', '/workspace/group-suite/node_modules', 'C:\\workspace\\group-suite\\lib', '/workspace/group-suite/.zhin'])('excludes fixture generated dependencies with native separators: %s', path => {
  expect(shouldCopyFixture(path)).toBe(false);
});
it.each(['C:\\workspace\\group-suite\\commands', '/workspace/group-suite/src'])('retains author sources: %s', path => {
  expect(shouldCopyFixture(path)).toBe(true);
});
it('keeps base tests on Node20 while requesting native SQLite only on supported test runtimes', () => {
  expect(sqliteRuntimeArguments('20.19.0')).toBeUndefined();
  expect(sqliteRuntimeArguments('22.4.0')).toBeUndefined();
  expect(sqliteRuntimeArguments('22.5.0')).toEqual(['--experimental-sqlite']);
  expect(sqliteRuntimeArguments('22.12.0')).toEqual(['--experimental-sqlite']);
  expect(sqliteRuntimeArguments('22.13.0')).toEqual([]);
  expect(sqliteRuntimeArguments('24.19.0')).toEqual([]);
});
