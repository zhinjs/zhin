import { describe, it, expect } from 'vitest';
import { buildRichSystemPrompt } from '../../src/zhin-agent/prompt.js';
import { DEFAULT_CONFIG, SECTION_SEP } from '../../src/zhin-agent/config.js';

function countSection(prompt: string, heading: string): number {
  return (prompt.match(new RegExp(`^# ${heading}`, 'gm')) || []).length;
}

describe('buildRichSystemPrompt section dedup', () => {
  it('toolSearch 下只注入一次 Runtime / Security / Orchestration 段', () => {
    const prompt = buildRichSystemPrompt({
      config: { ...DEFAULT_CONFIG, toolSearch: true },
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      toolSearchDeferredStats: 'other(9), github(8)',
      platformSections: '## icqq / QQ\n\nhint',
    });
    expect(countSection(prompt, 'Runtime')).toBe(1);
    expect(countSection(prompt, 'Security')).toBe(1);
    expect(countSection(prompt, 'Orchestration')).toBe(1);
    expect(countSection(prompt, 'Deferred Tools')).toBe(0);
    expect(countSection(prompt, 'Environment')).toBe(0);
    expect(countSection(prompt, 'System')).toBe(0);
  });

  it('persona 已含旧 Environment/System 时不再额外注入同名旧段', () => {
    const pollutedPersona = [
      DEFAULT_CONFIG.persona,
      '',
      '# Environment',
      ' - CWD: /old',
      '',
      SECTION_SEP,
      '',
      '# System',
      ' - Old system rule',
    ].join('\n');

    const prompt = buildRichSystemPrompt({
      config: { ...DEFAULT_CONFIG, persona: pollutedPersona },
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(countSection(prompt, 'Environment')).toBe(1);
    expect(countSection(prompt, 'System')).toBe(1);
    expect(countSection(prompt, 'Runtime')).toBe(1);
  });
});
