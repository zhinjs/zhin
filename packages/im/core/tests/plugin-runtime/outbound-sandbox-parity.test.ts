import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { projectOutboundPayload } from '../../src/plugin-runtime/im/outbound-renderer.js';
import {
  OUTBOUND_SEGMENT_CATALOG,
  OUTBOUND_SEGMENT_TYPES,
  isCanonicalSegment,
  isOutboundSegmentType,
  segmentsForImDelivery,
} from '../../src/built/segment-contract/index.js';

/**
 * ADR 0064 §0.1 / §6: an endpoint that declares the highest level of every outbound segment
 * capability (the Sandbox's declaration; the Sandbox package asserts it declares exactly this
 * ceiling and replays the catalog through its real Endpoint) takes no degradation path at all.
 */
const CEILING = { html: 'direct', markdown: 'native', outboundMedia: ['url', 'base64', 'path'], interactive: 'native' } as const;

const conversation = { endpoint: { id: 'adapter:ceiling', adapter: 'ceiling' }, kind: 'group', id: 'group-1' } as ConversationRef;
const snapshot = {
  root: 'root', tree: new Map(),
  capabilities: new Map([['adapter:ceiling', { definition: { segments: CEILING } }]]),
  resources: new Map([['root', new Map()]]),
} as unknown as RuntimeSnapshot;

describe('ADR 0064 outbound segment catalog', () => {
  it('lists every type once, each with a valid canonical example', () => {
    expect(new Set(OUTBOUND_SEGMENT_TYPES).size).toBe(OUTBOUND_SEGMENT_TYPES.length);
    for (const entry of OUTBOUND_SEGMENT_CATALOG) {
      expect(entry.example.type).toBe(entry.type);
      expect(isCanonicalSegment(entry.example), entry.type).toBe(true);
      expect(isOutboundSegmentType(entry.type)).toBe(true);
    }
    // The inbound-only action segment is not an outbound type.
    expect(isOutboundSegmentType('action')).toBe(false);
  });

  it('derives the IM delivery filter from the catalog', () => {
    const examples = OUTBOUND_SEGMENT_CATALOG.map((entry) => entry.example);
    expect(segmentsForImDelivery(examples)).toEqual(examples);
    expect(segmentsForImDelivery([{ type: 'thinking', data: { text: 'hidden' } }])).toEqual([]);
  });

  it.each(OUTBOUND_SEGMENT_CATALOG.map((entry) => [entry.type, entry] as const))(
    'projects %s on the capability ceiling without any fallback',
    async (_type, entry) => {
      const result = await projectOutboundPayload([entry.example], conversation, snapshot);
      expect(result.rendering.fallbacks).toEqual([]);
      const payload = result.payload as Array<{ type: string }>;
      expect(payload.map((segment) => segment.type)).toEqual([entry.canonicalType]);
    },
  );

  it('projects one mixed message of every catalog example without any fallback, in order', async () => {
    const result = await projectOutboundPayload(OUTBOUND_SEGMENT_CATALOG.map((entry) => entry.example), conversation, snapshot);
    expect(result.rendering.fallbacks).toEqual([]);
    expect((result.payload as Array<{ type: string }>).map((segment) => segment.type))
      .toEqual(OUTBOUND_SEGMENT_CATALOG.map((entry) => entry.canonicalType));
  });

  it('stamps the design width on direct HTML without a width and keeps an explicit one (D5)', async () => {
    const plain = await projectOutboundPayload({ type: 'html', data: { html: '<b>x</b>' } }, conversation, snapshot);
    expect(plain.payload).toEqual([{ type: 'html', data: { html: '<b>x</b>', width: 540 } }]);
    const sized = await projectOutboundPayload({ type: 'html', data: { html: '<b>x</b>', width: 1080 } }, conversation, snapshot);
    expect(sized.payload).toEqual([{ type: 'html', data: { html: '<b>x</b>', width: 1080 } }]);
  });
});
