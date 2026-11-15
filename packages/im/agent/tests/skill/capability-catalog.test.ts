import { describe, expect, it } from 'vitest';
import {
  CATALOG_MAX_ENTRIES,
  oneLineDescription,
  renderAgentCatalog,
  renderDeferredToolIndex,
  SKILL_CATALOG_BUDGET_CHARS,
  SKILL_CATALOG_ENTRY_MAX_CHARS,
  SKILL_TRIGGER_MAX_CHARS,
  TOOL_INDEX_MAX_NAMES_PER_GROUP,
  formatSkillCatalogEntry,
  skillCatalogParts,
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

  it('renders only the Skill directory without shared loading guidance', () => {
    const text = renderSkillCatalog([{ name: 'weekly-report', description: 'Write the report.\nInternal notes.' }])!;
    expect(text).toContain('## Available skills');
    expect(text).not.toContain('load_skill(name)');
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

  it('keeps the first sentence per skill, sorted by name and byte-stable', () => {
    const long = 'Manage the weekly team report and remind every member about it. Then more detail follows.';
    const text = renderSkillCatalog([
      { name: 'zeta', description: '整理周报。其余细节不进目录' },
      { name: 'alpha', description: long },
    ])!;
    const lines = text.split('\n').filter((line) => line.startsWith('- '));
    expect(lines.map((line) => line.split(':')[0])).toEqual(['- alpha', '- zeta']);
    // No fixed 40-character clip any more (#1250 b27): the whole first sentence fits the budget.
    expect(lines[0]).toBe('- alpha: Manage the weekly team report and remind every member about it');
    expect(lines[1]).toBe('- zeta: 整理周报');
    expect(text).not.toContain('Then more detail');
    expect(renderSkillCatalog([{ name: 'a', description: long }, { name: 'b', description: 'x' }])).toBe(
      renderSkillCatalog([{ name: 'b', description: 'x' }, { name: 'a', description: long }]),
    );
  });

  it('triggerSentence still clips a summary to its maximum', () => {
    const long = 'Manage the weekly team report and remind every member about it. Then more detail follows.';
    expect(triggerSentence(long).length).toBeLessThanOrEqual(SKILL_TRIGGER_MAX_CHARS);
    expect(triggerSentence(long).endsWith('…')).toBe(true);
  });

  describe('trigger words (#1250 b27)', () => {
    const github = {
      name: 'github',
      description: 'Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects. '
        + 'Use when asked to write an issue, PR description, changelog entry, or review comment. '
        + 'Triggers: 写 issue, PR 描述, 提 PR, release notes, gh pr.',
      keywords: ['github', 'issue', 'pull request', 'pr', 'release notes', '写 issue', 'PR 描述'],
    };

    it('splits the scaffold description into summary, Use when clause and trigger words', () => {
      const parts = skillCatalogParts(github.description, github.keywords);
      expect(parts.summary).toBe('Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects');
      expect(parts.useWhen).toBe('Use when asked to write an issue, PR description, changelog entry, or review comment');
      // Description triggers first, then keywords; duplicates (case-insensitive) dropped.
      expect(parts.triggers).toEqual(['写 issue', 'PR 描述', '提 PR', 'release notes', 'gh pr', 'github', 'issue', 'pull request', 'pr']);
    });

    it('reads multi-line and Chinese trigger labels and a leading Use when sentence', () => {
      const parts = skillCatalogParts('在当前会话创建提醒。\nUse when the user asks to be reminded.\nDo NOT use for cron.\n触发词：提醒我、闹钟、过会儿叫我。');
      expect(parts).toEqual({
        summary: '在当前会话创建提醒',
        useWhen: 'Use when the user asks to be reminded',
        triggers: ['提醒我', '闹钟', '过会儿叫我'],
      });
      expect(skillCatalogParts('Use when drafting a PR. Triggers: PR').summary).toBe('');
      expect(skillCatalogParts('No triggers here', ['kw']).triggers).toEqual(['kw']);
    });

    it('keeps the Use when clause and every trigger word in the catalog entry', () => {
      const text = renderSkillCatalog([github])!;
      expect(text).toContain('- github: Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects'
        + ' | Use when asked to write an issue, PR description, changelog entry, or review comment'
        + ' | Triggers: 写 issue, PR 描述, 提 PR, release notes, gh pr, github, issue, pull request, pr');
      expect(formatSkillCatalogEntry(github)).toBe(text.split('\n')[1]);
    });

    it('lists keywords even when the description has no trigger section', () => {
      const text = renderSkillCatalog([{ name: 'plugin-test', description: '为插件编写测试。引导编写 Vitest 测试。', keywords: ['测试', 'vitest'] }])!;
      expect(text).toContain('- plugin-test: 为插件编写测试 | Triggers: 测试, vitest');
    });
  });

  describe('catalog budget (#1250 b27)', () => {
    const skill = (index: number) => ({
      name: `skill-${String(index).padStart(2, '0')}`,
      description: `${'Summary text that explains what this skill does in detail '.repeat(2)}number ${index}. `
        + 'Use when the user asks for this exact workflow in a chat. '
        + `Triggers: 触发${index}, trigger-${index}`,
    });
    const entryLines = (text: string) => text.split('\n').filter((line) => line.startsWith('- '));
    const size = (text: string) => entryLines(text).reduce((sum, line) => sum + line.length + 1, 0);

    it('keeps everything while the catalog fits the budget', () => {
      const skills = [skill(1), skill(2)];
      const text = renderSkillCatalog(skills)!;
      expect(size(text)).toBeLessThan(SKILL_CATALOG_BUDGET_CHARS);
      for (const line of entryLines(text)) {
        expect(line).not.toContain('…');
        expect(line).toContain('Use when the user asks');
      }
    });

    it('clips summaries before Use when clauses, and keeps trigger words', () => {
      const skills = Array.from({ length: 10 }, (_, index) => skill(index));
      const full = renderSkillCatalog(skills, Number.MAX_SAFE_INTEGER)!;
      const budget = size(full) - 300;
      const text = renderSkillCatalog(skills, budget)!;
      expect(size(text)).toBeLessThanOrEqual(budget);
      for (const [index, line] of entryLines(text).entries()) {
        expect(line).toContain('…');
        expect(line).toContain('| Use when the user asks for this exact workflow in a chat |');
        expect(line).toContain(`Triggers: 触发${index}, trigger-${index}`);
      }
    });

    it('drops prose entirely before it clips trigger words', () => {
      const skills = Array.from({ length: 10 }, (_, index) => skill(index));
      const triggersOnly = skills.map((entry, index) => `- ${entry.name}: Triggers: 触发${index}, trigger-${index}`);
      const budget = triggersOnly.reduce((sum, line) => sum + line.length + 1, 0) + 40;
      const text = renderSkillCatalog(skills, budget)!;
      expect(size(text)).toBeLessThanOrEqual(budget);
      for (const [index, line] of entryLines(text).entries()) {
        expect(line).not.toContain('Summary text');
        expect(line).toContain(`trigger-${index}`);
      }
    });

    it('caps a single verbose entry so it cannot take the whole budget', () => {
      const verbose = { name: 'verbose', description: `${'word '.repeat(200)}. Triggers: keep-me` };
      const line = entryLines(renderSkillCatalog([verbose])!)[0]!;
      expect(line.length).toBeLessThanOrEqual(SKILL_CATALOG_ENTRY_MAX_CHARS);
      expect(line).toContain('Triggers: keep-me');
    });
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
      expect(toolIndexGroup({ owner: 'root/calendar', fullTool: fullTool('/packages/calendar/tools/add/index.js') })).toBe('root/calendar');
      expect(toolIndexGroup({ owner: 'root/calendar', mcpServer: 'git', fullTool: fullTool('/packages/calendar/tools/add/index.js') })).toBe('mcp:git');
      expect(toolIndexGroup({ fullTool: fullTool('plugin:calendar') })).toBe('calendar');
      expect(toolIndexGroup({ fullTool: fullTool('builtin:context') })).toBe('builtin:context');
      expect(toolIndexGroup({ fullTool: fullTool('mcp:git') })).toBe('mcp:git');
      expect(toolIndexGroup({ fullTool: fullTool() })).toBe('other');
    });

    it('does not use diagnostic source paths as model-visible domains', () => {
      for (const source of ['/workspace/node_modules/.pnpm/example@1/tools/add/index.js', './tools/add/index.ts', 'C:\\workspace\\tools\\add.ts']) {
        expect(toolIndexGroup({ fullTool: { source } })).toBe('other');
      }
    });
  });
});
