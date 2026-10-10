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
