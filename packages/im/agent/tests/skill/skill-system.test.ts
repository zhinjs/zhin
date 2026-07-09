import { describe, expect, it } from 'vitest';
import { SkillSystem } from '../../src/skill/skill-system.js';
import { SkillRegistry } from '../../src/orchestrator/skill-registry.js';

describe('SkillSystem', () => {
  it('getAlwaysSkills returns empty for registries without the hook', () => {
    const registry = { size: 0 } as unknown as SkillRegistry;
    const system = new SkillSystem(registry);
    expect(system.getAlwaysSkills()).toEqual([]);
  });

  it('search returns scored skill results from registry', () => {
    const registry = new SkillRegistry();
    registry.add({
      name: 'weather',
      description: 'weather skill',
      tools: [],
      keywords: ['天气'],
      pluginName: 'p1',
    }, 'p1');
    const system = new SkillSystem(registry);
    const results = system.search('天气');
    expect(results[0]?.skill.name).toBe('weather');
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});
