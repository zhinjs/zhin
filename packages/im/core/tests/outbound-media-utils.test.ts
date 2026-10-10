import { expectTypeOf } from 'vitest';
import type { JSXElement } from '@zhin.js/jsx';
import type { ComponentCall, RawContent } from '../src/plugin-runtime/im/contracts.js';
import { asMessageElements, collectOutboundMediaKinds, type RenderedMessageContent } from '../src/built/outbound-media-utils.js';
import { segment } from '../src/utils.js';

it('flattens already rendered message content and collects media kinds in first-seen order', () => {
  const audio = { type: 'audio', data: { media: { kind: 'url', value: 'https://example.test/audio' } } };
  const content: RenderedMessageContent = ['intro', [segment.image({ kind: 'url', value: 'https://example.test/image' }), ['caption']], segment.image({ kind: 'url', value: 'https://example.test/another' }), audio];
  expect(asMessageElements(content)).toEqual([
    segment.text('intro'), segment.image({ kind: 'url', value: 'https://example.test/image' }), segment.text('caption'),
    segment.image({ kind: 'url', value: 'https://example.test/another' }), audio,
  ]);
  expect(collectOutboundMediaKinds(content)).toEqual(['image', 'audio']);
  expect(collectOutboundMediaKinds(undefined)).toEqual([]);
});

it('keeps authoring values out of the rendered-content helper contract', () => {
  expectTypeOf<Parameters<typeof asMessageElements>[0]>().toEqualTypeOf<RenderedMessageContent>();
  expectTypeOf<RenderedMessageContent>().extract<JSXElement | ComponentCall | RawContent>().toEqualTypeOf<never>();
});
