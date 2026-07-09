import { describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../src/orchestrator/skill-registry.js';

describe('SkillRegistry TF-IDF search', () => {
  it('ranks skill with matching keyword higher than unrelated skill', () => {
    const registry = new SkillRegistry();
    registry.add({
      name: 'weather',
      description: 'forecast and alerts',
      tools: [],
      keywords: ['天气', 'forecast'],
      pluginName: 'p1',
    }, 'p1');
    registry.add({
      name: 'code_review',
      description: 'review pull requests',
      tools: [],
      keywords: ['lint', 'review'],
      pluginName: 'p1',
    }, 'p1');

    const scored = registry.searchScored('天气 forecast');
    expect(scored[0]?.skill.name).toBe('weather');
    expect(scored[0]!.score).toBeGreaterThan(scored[1]?.score ?? 0);
  });

  it('search() returns skills ordered by TF-IDF score', () => {
    const registry = new SkillRegistry();
    registry.add({
      name: 'alpha',
      description: 'alpha beta',
      tools: [],
      keywords: ['alpha'],
      pluginName: 'p1',
    }, 'p1');
    registry.add({
      name: 'beta',
      description: 'gamma delta',
      tools: [],
      keywords: ['gamma'],
      pluginName: 'p1',
    }, 'p1');

    const names = registry.search('alpha beta').map(s => s.name);
    expect(names[0]).toBe('alpha');
  });
});
