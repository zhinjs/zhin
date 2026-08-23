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
  it('separates render order from budget retention and enforces per-section caps', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('preferred', {
      layer: 'context',
      title: 'Preferred',
      content: 'P'.repeat(80),
      order: 100,
      retention: 'preferred',
      maxChars: 40,
    });
    registry.register('opportunistic', {
      layer: 'examples',
      title: 'Opportunistic',
      content: 'O'.repeat(80),
      order: 200,
      retention: 'opportunistic',
    });

    const entries = registry.entries();
    expect(entries.map((entry) => entry.id)).toEqual(['opportunistic', 'preferred']);
    const output = registry.build(70);
    expect(output).toContain('P'.repeat(20));
    expect(output).not.toContain('O'.repeat(20));
    expect(output.length).toBeLessThanOrEqual(70);
  });

  it('rejects duplicate identities and required content that cannot fit the budget', () => {
    const registry = new PromptAssemblyRegistry();
    const required = {
      layer: 'safety' as const,
      title: 'Required',
      content: 'R'.repeat(100),
      order: 100,
      retention: 'required' as const,
    };
    registry.register('required', required);

    expect(() => registry.register('required', required)).toThrow(/Duplicate Prompt Section/);
    expect(() => registry.build(50)).toThrow(/required Prompt Sections exceed the 50 character budget/);
  });

  it('registers and sorts sections by order', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('low', {
      layer: 'context',
      title: 'Low',
      content: 'low content',
      order: 10,
      retention: 'preferred',
    });
    registry.register('high', {
      layer: 'system',
      title: 'High',
      content: 'high content',
      order: 100,
      retention: 'required',
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
      order: 100,
      retention: 'required',
    });
    registry.register('details', {
      layer: 'context',
      title: 'Details',
      content: 'D'.repeat(100),
      order: 50,
      retention: 'preferred',
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
      order: 95,
      retention: 'preferred',
    });

    const prompt = buildRichSystemPrompt({
      ...baseContext,
      registry,
    });

    expect(prompt).toContain('# Custom');
    expect(prompt).toContain('hello registry');
  });
});
