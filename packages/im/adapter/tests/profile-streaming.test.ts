import { describe, expect, it } from 'vitest';
import {
  narrowCapabilities,
  normalizeCapabilityProfile,
  profileStreamingMismatch,
  resolveStaticCapabilities,
  type AdapterCapabilityProfile,
} from '../src/index.js';

describe('messaging.streaming (ADR 0064 §5)', () => {
  it('validates the mode and formats and fails closed on anything else', () => {
    const profile = normalizeCapabilityProfile({
      default: { messaging: { streaming: { mode: 'native', formats: ['text', 'markdown', 'text'] } } },
      group: { messaging: { streaming: false } },
    });
    expect(profile.default?.messaging?.streaming).toEqual({ mode: 'native', formats: ['text', 'markdown'] });
    expect(resolveStaticCapabilities(profile, ['group']).messaging?.streaming).toBeUndefined();
    expect(() => normalizeCapabilityProfile({ default: { messaging: { streaming: { mode: 'push' as never } } } }))
      .toThrow(/messaging\.streaming\.mode/u);
    expect(() => normalizeCapabilityProfile({ default: { messaging: { streaming: { mode: 'native', formats: ['html' as never] } } } }))
      .toThrow(/streaming\.formats/u);
    expect(() => normalizeCapabilityProfile({ default: { messaging: { streaming: { formats: ['text'] } as never } } }))
      .toThrow(/streaming\.mode: is required/u);
  });

  it('only narrows: a turn may switch streaming off or drop a format, never enable it', () => {
    const base = resolveStaticCapabilities(normalizeCapabilityProfile({
      default: { messaging: { streaming: { mode: 'native', formats: ['text', 'markdown'] } } },
    }), ['private']);
    expect(narrowCapabilities(base, { messaging: { streaming: { mode: 'none' } } }).messaging?.streaming)
      .toEqual({ mode: 'none', formats: ['text', 'markdown'] });
    expect(narrowCapabilities(base, { messaging: { streaming: { formats: ['text'] } } }).messaging?.streaming)
      .toEqual({ mode: 'native', formats: ['text'] });
    const report = { warnings: [] as string[] };
    expect(narrowCapabilities(base, { messaging: { streaming: { mode: 'edit' } } }, report)).toBe(base);
    expect(report.warnings).toEqual(['messaging.streaming.mode: can only be switched to none']);
    const off = resolveStaticCapabilities(normalizeCapabilityProfile({ default: { delivery: { send: true } } }), ['private']);
    const widened = { warnings: [] as string[] };
    narrowCapabilities(off, { messaging: { streaming: { mode: 'native' } } }, widened);
    expect(widened.warnings.some((warning) => warning.includes('cannot enable'))).toBe(true);
  });

  it('reports a declaration that disagrees with the Endpoint streaming spec (D11)', () => {
    const native: AdapterCapabilityProfile = { default: { messaging: { streaming: { mode: 'native' } } } };
    expect(profileStreamingMismatch(native, 'native')).toBeUndefined();
    expect(profileStreamingMismatch(native, undefined)).toMatch(/Endpoint has no streaming/u);
    expect(profileStreamingMismatch(native, 'card')).toMatch(/streams in mode card/u);
    expect(profileStreamingMismatch({ default: {} }, 'draft')).toMatch(/does not declare messaging\.streaming/u);
    expect(profileStreamingMismatch({ default: {} }, undefined)).toBeUndefined();
    expect(profileStreamingMismatch({ default: { messaging: { streaming: false } } }, 'native')).toMatch(/declares messaging\.streaming off/u);
    expect(profileStreamingMismatch({ default: { messaging: { streaming: { mode: 'none' } } } }, undefined)).toBeUndefined();
  });
});
