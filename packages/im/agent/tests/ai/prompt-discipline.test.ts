import { describe, it, expect } from 'vitest';
import { buildRichSystemPrompt, FIXED_DISCIPLINE_RULES } from '../../src/zhin-agent/prompt.js';
import { DEFAULT_CONFIG } from '../../src/zhin-agent/config.js';

describe('Prompt discipline block', () => {
  it('direct-tool prompt 应包含固定纪律规则', () => {
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

  it('常驻段应保持精简结构', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(prompt).toContain('# Context');
    expect(prompt).toContain('# Style');
    expect(prompt).toContain('# Tools');
    expect(prompt).toContain('# Safety');
    expect(prompt).not.toContain('# Discipline');
    expect(prompt).not.toContain('# Doing tasks');
    expect(prompt).not.toContain('# Action safety');
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
    expect(prompt).toContain('Use run_deferred_task for real work');
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
