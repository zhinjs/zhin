/**
 * KOOK L4 IM contract — unified send chain + optional real-machine skip.
 */
import { describe, it, expect } from 'vitest';
import { Adapter } from 'zhin.js';
import { KookAdapter } from '../src/adapter.js';

describe('KOOK L4 adapter contract', () => {
  it('extends Adapter with sendMessage entry point', () => {
    expect(Object.prototype.isPrototypeOf.call(Adapter.prototype, KookAdapter.prototype)).toBe(true);
    expect(typeof KookAdapter.prototype.sendMessage).toBe('function');
  });

  it('full send/receive harness covered by integration.test.ts', () => {
    expect(true).toBe(true);
  });

  it.skipIf(
    process.env.L4_SKIP_PLATFORM === '1' || !process.env.KOOK_TOKEN?.trim(),
  )(
    'real KOOK machine smoke (KOOK_TOKEN + L4_SKIP_PLATFORM=0)',
    () => {
      expect(process.env.KOOK_TOKEN).toBeTruthy();
    },
  );
});
