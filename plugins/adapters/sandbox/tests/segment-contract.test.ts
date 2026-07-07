/**
 * sandbox segment contract — text + mention round-trip
 */
import { describe, expect, it } from 'vitest';
import { SandboxWsHostAdapter } from '../src/sandbox-ws.js';
import { fromCanonicalSegments, toCanonicalSegments } from '../src/segment-mapper.js';
import { assertSegmentRoundTrip } from '../../../../packages/im/core/tests/helpers/segment-adapter-contract.js';

const mapper = { toCanonicalSegments, fromCanonicalSegments };

describe('sandbox segment contract', () => {
  it('declares adapter class', () => {
    expect(SandboxWsHostAdapter.interactivePolicy).toBe('native');
  });

  it('normalizes legacy at to mention', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'at', data: { qq: '10001', name: 'Alice' } }],
      [{ type: 'mention', data: { target: '10001', name: 'Alice' } }],
    );
  });

  it('normalizes mention target all', () => {
    assertSegmentRoundTrip(
      mapper,
      [{ type: 'mention', data: { target: 'all', name: '全体成员' } }],
      [{ type: 'mention', data: { target: 'all', name: '全体成员' } }],
    );
  });

  it('round-trips text + mention', () => {
    assertSegmentRoundTrip(
      mapper,
      [
        { type: 'text', data: { text: '你好 ' } },
        { type: 'mention', data: { target: '10002', name: 'Bob' } },
      ],
      [
        { type: 'text', data: { text: '你好 ' } },
        { type: 'mention', data: { target: '10002', name: 'Bob' } },
      ],
    );
  });
});
