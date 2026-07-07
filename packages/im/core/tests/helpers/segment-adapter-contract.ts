/**
 * Segment adapter 契约测试 helper
 */
import { expect } from 'vitest';
import {
  assertCanonicalSegments,
  isCanonicalSegment,
  type Segment,
} from '@zhin.js/core';

export type SegmentMapper = {
  toCanonicalSegments: (content: readonly unknown[]) => Segment[];
  fromCanonicalSegments?: (segments: readonly Segment[]) => unknown[];
};

export function assertSegmentRoundTrip(
  mapper: SegmentMapper,
  wire: unknown[],
  expectedCanonical: Segment[],
): void {
  const canonical = mapper.toCanonicalSegments(wire);
  assertCanonicalSegments(canonical);
  expect(canonical).toEqual(expectedCanonical);

  if (mapper.fromCanonicalSegments) {
    const roundTrip = mapper.toCanonicalSegments(mapper.fromCanonicalSegments(canonical));
    expect(roundTrip).toEqual(expectedCanonical);
  }
}

export function smokeCanonicalMentionTarget(seg: unknown): void {
  expect(isCanonicalSegment(seg)).toBe(true);
  if (!isCanonicalSegment(seg) || seg.type !== 'mention') return;
  expect(typeof seg.data.target).toBe('string');
  expect(seg.data.target.length).toBeGreaterThan(0);
}
