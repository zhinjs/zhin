import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import {
  PromptAssemblyRegistry,
} from '../../src/prompt/prompt-assembly-registry.js';
import {
  buildRichSystemPrompt,
  createDefaultPromptAssemblyRegistry,
} from '../../src/prompt/system-prompt.js';

const baseContext = {
  config: DEFAULT_CONFIG,
  skillRegistry: null,
  skillsSummaryXML: '',
  activeSkillsContext: '',
  bootstrapContext: '',
} as const;

describe('PromptAssemblyRegistry', () => {
  it('registers and sorts sections by priority', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('low', {
      layer: 'context',
      title: 'Low',
      content: 'low content',
      priority: 10,
      truncatable: true,
    });
    registry.register('high', {
      layer: 'system',
      title: 'High',
      content: 'high content',
      priority: 100,
      truncatable: false,
    });

    const entries = registry.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('high');
    expect(entries[0].content).toBe('high content');
    expect(entries[1].id).toBe('low');
  });

  it('enforces budget constraints through registered sections', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('system', {
      layer: 'system',
      title: 'System',
      content: 'S'.repeat(100),
      priority: 100,
      truncatable: false,
    });
    registry.register('details', {
      layer: 'context',
      title: 'Details',
      content: 'D'.repeat(100),
      priority: 50,
      truncatable: true,
    });

    const out = registry.build(150);
    expect(out).toContain('S'.repeat(100));
    expect(out).toContain('… (truncated)');
    expect(out.length).toBeLessThanOrEqual(150);
  });

  it('preserves default rich prompt output when using the default registry', () => {
    const registry = createDefaultPromptAssemblyRegistry(baseContext);
    const prompt = buildRichSystemPrompt(baseContext);
    expect(registry.build(DEFAULT_CONFIG.systemPromptMaxChars, baseContext)).toBe(prompt);
  });

  it('merges custom registry sections into rich prompt assembly', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('custom', {
      layer: 'context',
      title: 'Custom',
      content: '# Custom\nhello registry',
      priority: 95,
      truncatable: true,
    });

    const prompt = buildRichSystemPrompt({
      ...baseContext,
      registry,
    });

    expect(prompt).toContain('# Custom');
    expect(prompt).toContain('hello registry');
  });
});
