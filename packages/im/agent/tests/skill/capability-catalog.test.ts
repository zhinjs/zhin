import { describe, expect, it } from 'vitest';
import {
  CATALOG_MAX_ENTRIES,
  oneLineDescription,
  renderAgentCatalog,
  renderDeferredToolIndex,
  SKILL_TRIGGER_MAX_CHARS,
  TOOL_INDEX_MAX_NAMES_PER_GROUP,
  toolIndexGroup,
  triggerSentence,
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
    expect(text).toContain('- weekly-report: Write the report');
    expect(text).not.toContain('Internal notes');
  });

  it('caps long catalogs and points the model at discover', () => {
    const pad = (index: number) => `s${String(index).padStart(2, '0')}`;
    const skills = Array.from({ length: CATALOG_MAX_ENTRIES + 5 }, (_, index) => ({ name: pad(index), description: 'd' }));
    const text = renderSkillCatalog(skills)!;
    expect(text).toContain(`- ${pad(CATALOG_MAX_ENTRIES - 1)}: d`);
    expect(text).not.toContain(`- ${pad(CATALOG_MAX_ENTRIES)}: d`);
    expect(text).toContain('…and 5 more; use discover(kind=skill)');
  });

  it('returns nothing for empty catalogs', () => {
    expect(renderSkillCatalog([])).toBeUndefined();
    expect(renderAgentCatalog([])).toBeUndefined();
    expect(renderDeferredToolIndex([])).toBeUndefined();
  });

  it('keeps one trigger sentence of at most 40 characters per skill, sorted by name', () => {
    const long = 'Manage the weekly team report and remind every member about it. Then more detail follows.';
    const text = renderSkillCatalog([
      { name: 'zeta', description: '整理周报。其余细节不进目录' },
      { name: 'alpha', description: long },
    ])!;
    const lines = text.split('\n').filter((line) => line.startsWith('- '));
    expect(lines.map((line) => line.split(':')[0])).toEqual(['- alpha', '- zeta']);
    expect(lines[0]).toBe(`- alpha: ${triggerSentence(long)}`);
    expect(triggerSentence(long).length).toBeLessThanOrEqual(SKILL_TRIGGER_MAX_CHARS);
    expect(triggerSentence(long).endsWith('…')).toBe(true);
    expect(lines[1]).toBe('- zeta: 整理周报');
    expect(text).not.toContain('Then more detail');
    expect(renderSkillCatalog([{ name: 'a', description: long }, { name: 'b', description: 'x' }])).toBe(
      renderSkillCatalog([{ name: 'b', description: 'x' }, { name: 'a', description: long }]),
    );
  });

  describe('folded deferred tool index', () => {
    const tool = (name: string, group?: string) => ({ name, description: `${name} does something long and detailed`, group });

    it('renders one line per domain with names and the count, groups sorted', () => {
      const text = renderDeferredToolIndex([
        tool('mute', 'group-admin'), tool('kick', 'group-admin'), tool('add_event', 'calendar'),
      ])!;
      expect(text).toContain('## Deferred tools');
      expect(text).toContain('load_tool(name)');
      const lines = text.split('\n').filter((line) => line.startsWith('- '));
      expect(lines).toEqual(['- calendar: add_event (1)', '- group-admin: kick, mute (2)']);
      expect(text).not.toContain('does something');
    });

    it('caps the names per line but counts all of them', () => {
      const names = Array.from({ length: 9 }, (_, index) => `t${index}`);
      const line = renderDeferredToolIndex(names.map((name) => tool(name, 'g')))!.split('\n').find((entry) => entry.startsWith('- g:'))!;
      expect(line).toBe(`- g: ${names.slice(0, TOOL_INDEX_MAX_NAMES_PER_GROUP).join(', ')}, … (9)`);
    });

    it('puts tools without an owner in the ungrouped line', () => {
      expect(renderDeferredToolIndex([tool('x')])).toContain('- other: x (1)');
    });

    it('is byte-stable regardless of input order', () => {
      const tools = [tool('b', 'g2'), tool('a', 'g1'), tool('c', 'g1'), tool('d', 'g2')];
      expect(renderDeferredToolIndex(tools)).toBe(renderDeferredToolIndex([...tools].reverse()));
    });

    it('derives the domain from the MCP server, else the tool owner', () => {
      const fullTool = (source?: string) => ({ source });
      expect(toolIndexGroup({ mcpServer: 'git', fullTool: fullTool('mcp:git') })).toBe('mcp:git');
      expect(toolIndexGroup({ fullTool: fullTool('plugin:calendar') })).toBe('calendar');
      expect(toolIndexGroup({ fullTool: fullTool('builtin:context') })).toBe('builtin:context');
      expect(toolIndexGroup({ fullTool: fullTool() })).toBe('other');
    });
  });
});
