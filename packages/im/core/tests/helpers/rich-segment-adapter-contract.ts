/**
 * Rich Segment adapter 契约测试 helper
 */
import { expect } from 'vitest';
import { Adapter, assertAdapterDeclaresRichSegmentPolicy, resolveRichSegments } from '@zhin.js/core';

export function assertRichSegmentOutboundContract(
  AdapterClass: typeof Adapter,
  adapterName: string,
): void {
  expect(Object.prototype.isPrototypeOf.call(Adapter.prototype, AdapterClass.prototype)).toBe(true);
  assertAdapterDeclaresRichSegmentPolicy(AdapterClass);
  expect(AdapterClass.outboundRichSegmentPolicy).toBeDefined();
  expect(typeof AdapterClass.prototype.sendMessage).toBe('function');
}

export async function smokeResolveRichSegmentsTextMode(
  policy: Record<string, string>,
): Promise<void> {
  const { segment } = await import('@zhin.js/core');
  const out = await resolveRichSegments(
    segment.text('hello'),
    policy,
  );
  expect(out).toBeDefined();
}
