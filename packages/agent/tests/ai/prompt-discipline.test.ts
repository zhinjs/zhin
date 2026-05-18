import { describe, it, expect } from 'vitest';
import { buildRichSystemPrompt, FIXED_DISCIPLINE_RULES } from '../../src/zhin-agent/prompt.js';
import { DEFAULT_CONFIG } from '../../src/zhin-agent/config.js';

describe('Prompt discipline block', () => {
  it('应包含固定纪律规则', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    for (const rule of FIXED_DISCIPLINE_RULES) {
      expect(prompt).toContain(rule);
    }
  });

  it('纪律段应位于任务段之前', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(prompt.indexOf('# Discipline')).toBeGreaterThan(-1);
    expect(prompt.indexOf('# Discipline')).toBeLessThan(prompt.indexOf('# Doing tasks'));
  });

  it('toolSearch 通用段不含平台硬编码', () => {
    const prompt = buildRichSystemPrompt({
      config: { ...DEFAULT_CONFIG, toolSearch: true },
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(prompt).not.toMatch(/mcp_icqq/);
    expect(prompt).toContain('Platform section below');
  });

  it('platformSections 注入 §6c', () => {
    const prompt = buildRichSystemPrompt({
      config: { ...DEFAULT_CONFIG, toolSearch: true },
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      platformSections: 'icqq custom hint',
    });
    expect(prompt).toContain('# Platform');
    expect(prompt).toContain('icqq custom hint');
  });
});
