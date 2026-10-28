import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, SECTION_SEP } from '../../src/config/index.js';
import {
  PromptAssemblyRegistry,
} from '../../src/prompt/prompt-assembly-registry.js';
import {
  buildRichSystemPrompt,
  createDefaultPromptAssemblyRegistry,
  enforcePromptBudget,
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

  it('moves the capability tail after fixed rules without reducing its bootstrap retention priority', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('bootstrap', {
      layer: 'context', title: 'Bootstrap', content: 'B'.repeat(100), order: 155, retention: 'preferred',
    });
    registry.register('security', {
      layer: 'safety', title: 'Security', content: 'S'.repeat(100), order: 110, retention: 'required',
    });
    registry.register('global', {
      layer: 'context', title: 'Global', content: 'G'.repeat(100), order: 20, retention: 'preferred',
    });
    registry.register('capabilities', {
      layer: 'system', title: 'Capabilities', content: 'C'.repeat(100), order: 9,
      budgetOrder: 155, retention: 'preferred',
    });

    expect(registry.entries().map(entry => entry.id)).toEqual(['bootstrap', 'security', 'global', 'capabilities']);
    const capped = registry.build(350);
    const original = (maxChars: number) => enforcePromptBudget([
      { content: `${'B'.repeat(100)}\n\n${'C'.repeat(100)}`, order: 155, retention: 'preferred' },
      { content: 'S'.repeat(100), order: 110, retention: 'required' },
      { content: 'G'.repeat(100), order: 20, retention: 'preferred' },
    ], maxChars);
    expect(capped).toContain('B'.repeat(100));
    expect(capped).toContain('C'.repeat(100));
    expect(original(350)).toContain('C'.repeat(100));
    expect(capped).not.toContain('G'.repeat(100));
    expect(capped.length).toBeLessThanOrEqual(350);

    const smaller = registry.build(280);
    expect(smaller).toContain('B'.repeat(100));
    expect(smaller).toContain('S'.repeat(100));
    expect(smaller).not.toContain('G');
    expect(smaller).toContain('C'.repeat(20));
    expect(smaller).not.toContain('C'.repeat(100));
    expect(smaller.length).toBeLessThanOrEqual(280);
    // Only the existing section separator costs extra space; retention stays
    // global first, then capability tail, then stable bootstrap.
    expect(original(280)).toContain('B'.repeat(100));
    expect(original(280).match(/C+/)![0].length - smaller.match(/C+/)![0].length)
      .toBe(SECTION_SEP.length - '\n\n'.length);
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

  it('places platform guidance after the catalog while preserving its original order, cap and budget priority', () => {
    const registry = new PromptAssemblyRegistry();
    registry.register('catalog', {
      layer: 'system', title: 'Catalog', content: 'C'.repeat(40),
      order: 9, budgetOrder: 155, retention: 'preferred',
    });
    for (const id of ['platform-b', 'platform-a']) {
      registry.register(id, {
        layer: 'tools', title: id, content: id === 'platform-a' ? 'A'.repeat(80) : 'B'.repeat(80),
        order: 70, placement: 'tail', retention: 'preferred', maxChars: 40,
      });
    }
    expect(registry.entries().map(entry => entry.id)).toEqual(['catalog', 'platform-a', 'platform-b']);
    const full = registry.build(200);
    expect(full.startsWith(`${'C'.repeat(40)}${SECTION_SEP}`)).toBe(true);
    expect(full.split(SECTION_SEP).map(section => section.length)).toEqual([40, 40, 40]);
    expect(full.match(/… \(truncated\)/g)).toHaveLength(2);
    const capped = registry.build(80);
    expect(capped).toContain('C'.repeat(40));
    expect(capped).not.toContain('A'.repeat(40));
    expect(capped).not.toContain('B'.repeat(40));
    expect(capped.length).toBeLessThanOrEqual(80);
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
