/**
 * onebot11 segment contract — OneBot11 wire round-trip
 */
import { describe, it } from 'vitest';
import { fromCanonicalSegments, toCanonicalSegments } from '../src/segment-mapper.js';
import { assertSegmentRoundTrip } from '../../../../packages/im/core/tests/helpers/segment-adapter-contract.js';

const mapper = { toCanonicalSegments, fromCanonicalSegments };

describe('onebot11 segment contract', () => {
  it('normalizes legacy image url to MediaRef', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'image', data: { url: 'https://cdn.example/cat.jpg' } }],
      [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/cat.jpg' } },
      }],
    );
  });

  it('round-trips mention via at wire', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'at', data: { qq: '10001' } }],
      [{ type: 'mention', data: { target: '10001' } }],
    );
  });

  it('normalizes legacy forward id/resid to forward_id', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'forward', data: { id: 'fwd-9', resid: 'fwd-9' } }],
      [{
        type: 'forward',
        data: { forward_id: 'fwd-9' },
        platform: { resid: 'fwd-9' },
      }],
    );
  });
});
