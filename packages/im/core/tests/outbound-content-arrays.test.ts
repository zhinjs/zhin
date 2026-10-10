import { flattenOutboundArray } from '../src/built/outbound-content-arrays.js';
import { normalizeOutboundPayload } from '../src/plugin-runtime/im/outbound-segments.js';

it('iteratively flattens shared arrays while rejecting only active ancestry cycles', async () => {
  const shared = ['one', ['two']];
  expect(flattenOutboundArray([shared, shared])).toEqual(['one', 'two', 'one', 'two']);
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  expect(() => flattenOutboundArray(cyclic)).toThrow(TypeError);
  await expect(normalizeOutboundPayload(cyclic)).rejects.toThrow('Cyclic SendContent array');
});

it('rejects pathological native array depth before normalization without recursive stack overflow', async () => {
  let content: unknown[] = ['text'];
  for (let index = 1; index < 512; index++) content = [content];
  expect(flattenOutboundArray(content)).toEqual(['text']);
  await expect(normalizeOutboundPayload([content])).rejects.toThrow('SendContent array depth exceeded 512');
});

it('skips sparse array holes while preserving explicit undefined', () => {
  const inner = new Array<unknown>(3);
  inner[1] = 'content';
  const outer = new Array<unknown>(4);
  outer[1] = inner;
  outer[3] = undefined;
  expect(flattenOutboundArray(outer)).toEqual(['content', undefined]);
  expect(flattenOutboundArray(outer)).toEqual(outer.flat(Infinity));
});
