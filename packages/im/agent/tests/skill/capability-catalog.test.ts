import { describe, expect, it } from 'vitest';
import {
  CATALOG_MAX_ENTRIES,
  oneLineDescription,
  renderAgentCatalog,
  renderDeferredToolIndex,
  renderSkillCatalog,
} from '../../src/skill/capability-catalog.js';

describe('capability catalog', () => {
  it('keeps only the first line of a description, clipped', () => {
    expect(oneLineDescription('  First   line\nsecond line')).toBe('First line');
    const clipped = oneLineDescription('x'.repeat(200), 20);
    expect(clipped).toHaveLength(20);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('renders skills as name + trigger with the load_skill hint', () => {
    const text = renderSkillCatalog([{ name: 'weekly-report', description: 'Write the report.\nInternal notes.' }])!;
    expect(text).toContain('## Available skills');
    expect(text).toContain('load_skill(name)');
    expect(text).toContain('- weekly-report: Write the report.');
    expect(text).not.toContain('Internal notes');
  });

  it('caps long catalogs and points the model at discover', () => {
    const skills = Array.from({ length: CATALOG_MAX_ENTRIES + 5 }, (_, index) => ({ name: `s${index}`, description: 'd' }));
    const text = renderSkillCatalog(skills)!;
    expect(text).toContain(`- s${CATALOG_MAX_ENTRIES - 1}: d`);
    expect(text).not.toContain(`- s${CATALOG_MAX_ENTRIES}: d`);
    expect(text).toContain('…and 5 more; use discover(kind=skill)');
  });

  it('returns nothing for empty catalogs', () => {
    expect(renderSkillCatalog([])).toBeUndefined();
    expect(renderAgentCatalog([])).toBeUndefined();
    expect(renderDeferredToolIndex([])).toBeUndefined();
  });

  it('lists deferred tools with a short description and the load_tool hint', () => {
    const text = renderDeferredToolIndex([{ name: 'calendar_add', description: `Add an event. ${'detail '.repeat(30)}` }])!;
    expect(text).toContain('## Deferred tools');
    expect(text).toContain('load_tool(name)');
    const line = text.split('\n').find((entry) => entry.startsWith('- calendar_add'))!;
    expect(line.length).toBeLessThanOrEqual('- calendar_add: '.length + 60);
  });
});
