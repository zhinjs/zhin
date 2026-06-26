/**
 * Interactive Segment adapter 契约测试 helper
 */
import { expect } from 'vitest';
import {
  Adapter,
  assertAdapterDeclaresInteractivePolicy,
  resolveInteractiveSegments,
  segment,
} from '@zhin.js/core';

export function assertInteractiveOutboundContract(
  AdapterClass: typeof Adapter,
): void {
  expect(Object.prototype.isPrototypeOf.call(Adapter.prototype, AdapterClass.prototype)).toBe(true);
  assertAdapterDeclaresInteractivePolicy(AdapterClass);
}

export function smokeResolveInteractiveTextMode(policy: 'native' | 'text'): void {
  const out = resolveInteractiveSegments(
    [
      segment.text('board'),
      segment.keyboard([
        [segment.button({ id: 'a', label: '1', payload: 'game:1' })],
      ], { fallback: { hint: 'pick', map: { '1': 'game:1' } } }),
    ],
    policy,
  );
  expect(out).toBeDefined();
}
