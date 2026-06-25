import { describe, it, expect } from 'vitest';
import { diagnoseOptionalPeers, ADAPTERS_PREFER_HTML_IMAGE } from '../src/optional-peers.js';
import { diagnoseUpgradeToL4 } from '../src/upgrade-l4.js';

describe('diagnoseOptionalPeers', () => {
  it('requires speech when transcribe strategy is set', () => {
    const result = diagnoseOptionalPeers('/tmp', {
      ai: { enabled: true, multimodal: { audio: { strategy: 'transcribe' } } },
    }, { dependencies: {} });
    expect(result.speech?.required).toBe(true);
    expect(result.speech?.missingFromPackageJson).toContain('@zhin.js/speech');
  });

  it('requires html-renderer when kook adapter is configured', () => {
    const result = diagnoseOptionalPeers('/tmp', {
      plugins: ['@zhin.js/adapter-kook'],
    }, { dependencies: {} });
    expect(result.htmlRenderer?.required).toBe(true);
  });

  it('does not require peers for minimal IM-only config', () => {
    const result = diagnoseOptionalPeers('/tmp', { ai: { enabled: false } }, { dependencies: {} });
    expect(result.speech).toBeUndefined();
    expect(result.htmlRenderer).toBeUndefined();
  });
});

describe('diagnoseUpgradeToL4', () => {
  it('lists missing AI deps when ai disabled', () => {
    const result = diagnoseUpgradeToL4('/tmp', { ai: { enabled: false } }, { dependencies: {} });
    expect(result.missingAiDeps.length).toBeGreaterThan(0);
    expect(result.configSnippets.some((s) => s.includes('speech:'))).toBe(true);
  });
});

describe('ADAPTERS_PREFER_HTML_IMAGE', () => {
  it('includes kook', () => {
    expect(ADAPTERS_PREFER_HTML_IMAGE.has('kook')).toBe(true);
  });
});
