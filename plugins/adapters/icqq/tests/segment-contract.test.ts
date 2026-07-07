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

  it('normalizes legacy reply id to message_id', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'reply', data: { id: 'q-1' } }],
      [{ type: 'reply', data: { message_id: 'q-1' } }],
    );
  });

  it('normalizes legacy forward id/resid to forward_id', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'forward', data: { id: 'fwd-9', resid: 'fwd-9', title: '群聊' } }],
      [{
        type: 'forward',
        data: { forward_id: 'fwd-9', title: '群聊' },
        platform: { resid: 'fwd-9' },
      }],
    );
  });

  it('normalizes sticker/emoji to face', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'sticker', data: { id: '66', text: '笑哭' } }],
      [{ type: 'face', data: { id: '66', name: '笑哭' } }],
    );
  });

  it('round-trips mention via CQ at wire', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'at', data: { qq: '10001', name: 'Alice' } }],
      [{ type: 'mention', data: { target: '10001', name: 'Alice' } }],
    );
  });

  it('round-trips dice and rps', () => {
    assertSegmentRoundTrip(mapper, [{ type: 'dice', data: {} }], [{ type: 'dice', data: {} }]);
    assertSegmentRoundTrip(mapper, [{ type: 'rps', data: { result: 1 } }], [{ type: 'rps', data: { result: 1 } }]);
  });
});
