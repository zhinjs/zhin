import { describe, it } from 'vitest';
import { fromCanonicalSegments, toCanonicalSegments } from '../src/segment-mapper.js';
import { assertSegmentRoundTrip } from '../../../../packages/im/core/tests/helpers/segment-adapter-contract.js';

const mapper = { toCanonicalSegments, fromCanonicalSegments };

describe('lark segment contract', () => {
  it('round-trips text and mention', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'at', data: { id: 'u1', name: 'Bot' } }, { type: 'text', data: { text: ' hi' } }],
      [{ type: 'mention', data: { target: 'u1', name: 'Bot' } }, { type: 'text', data: { text: ' hi' } }],
    );
  });

  it('normalizes link url/text', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'link', data: { url: 'https://example.com', text: 'Example' } }],
      [{ type: 'link', data: { url: 'https://example.com', text: 'Example' } }],
    );
  });
});
