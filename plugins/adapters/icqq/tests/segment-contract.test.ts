/**
 * icqq segment contract — image MediaRef round-trip
 */
import { describe, it } from 'vitest';
import { fromCanonicalSegments, toCanonicalSegments } from '../src/segment-mapper.js';
import { assertSegmentRoundTrip } from '../../../../packages/im/core/tests/helpers/segment-adapter-contract.js';

const mapper = { toCanonicalSegments, fromCanonicalSegments };

describe('icqq segment contract', () => {
  it('normalizes legacy CQ image url to MediaRef', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'image', data: { url: 'https://cdn.example/cat.jpg', file: 'https://cdn.example/cat.jpg' } }],
      [{
        type: 'image',
        data: {
          media: { kind: 'url', value: 'https://cdn.example/cat.jpg' },
        },
        platform: { url: 'https://cdn.example/cat.jpg', file: 'https://cdn.example/cat.jpg' },
      }],
    );
  });

  it('round-trips canonical image MediaRef', () => {
    const canonical = [{
      type: 'image' as const,
      data: {
        media: { kind: 'url' as const, value: 'https://img.test/a.png', mime_type: 'image/png' },
        alt: 'a',
      },
    }];
    assertSegmentRoundTrip(mapper, canonical, canonical);
  });
});
