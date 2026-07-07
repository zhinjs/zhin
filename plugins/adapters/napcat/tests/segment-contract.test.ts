/**
 * napcat segment contract — OneBot11 wire round-trip
 */
import { describe, it } from 'vitest';
import { fromCanonicalSegments, toCanonicalSegments } from '../src/segment-mapper.js';
import { assertSegmentRoundTrip } from '../../../../packages/im/core/tests/helpers/segment-adapter-contract.js';

const mapper = { toCanonicalSegments, fromCanonicalSegments };

describe('napcat segment contract', () => {
  it('normalizes legacy image url to MediaRef', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'image', data: { url: 'https://cdn.example/cat.jpg', file: 'https://cdn.example/cat.jpg' } }],
      [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/cat.jpg' } },
        platform: { url: 'https://cdn.example/cat.jpg', file: 'https://cdn.example/cat.jpg' },
      }],
    );
  });

  it('round-trips mention via at wire', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'at', data: { qq: '10001', name: 'Alice' } }],
      [{ type: 'mention', data: { target: '10001', name: 'Alice' } }],
    );
  });

  it('normalizes legacy reply id to message_id', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'reply', data: { id: 'q-1' } }],
      [{ type: 'reply', data: { message_id: 'q-1' } }],
    );
  });

  it('round-trips dice and rps', () => {
    assertSegmentRoundTrip(mapper, [{ type: 'dice', data: {} }], [{ type: 'dice', data: {} }]);
    assertSegmentRoundTrip(mapper, [{ type: 'rps', data: { result: 1 } }], [{ type: 'rps', data: { result: 1 } }]);
  });
});
