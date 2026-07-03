import { describe, it, expect } from 'vitest';
import { buildRichSystemPrompt } from '../../src/zhin-agent/prompt.js';
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
    // 首条纪律已并入 DEFAULT_CONFIG.persona（措辞略短）；其余两条仅在直连 # Tools 段出现
    expect(prompt.toLowerCase()).toContain('never claim actions');
    expect(prompt).toContain('Never disclose implementation');
  });

  it('常驻段应保持精简结构', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(prompt).toContain('# Runtime');
    expect(prompt).toContain('Host:');
    expect(prompt).toContain('# Orchestration');
    expect(prompt).toContain('# Security');
    expect(prompt).toContain('Never disclose implementation');
    expect(prompt).toContain('Never disclose implementation');
    expect(prompt).not.toContain('# Context');
    expect(prompt).not.toContain('# Safety');
    expect(prompt).not.toContain('# File Permissions');
    expect(prompt).not.toContain('# Discipline');
    expect(prompt).not.toContain('# Doing tasks');
    expect(prompt).not.toContain('# Action safety');
  });

  it('编排通用段不含平台硬编码', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    });
    expect(prompt).not.toMatch(/mcp_icqq/);
    expect(prompt).toContain('# Orchestration');
    expect(prompt).toContain('Use available tools directly');
    expect(prompt).toContain('Use spawn_task for complex');
    expect(prompt).not.toContain('# Style');
    expect(prompt).not.toContain('# Deferred Tools');
  });

  it('platformSections 注入 §6c', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      platformSections: 'icqq custom hint',
    });
    expect(prompt).toContain('# Platform');
    expect(prompt).toContain('icqq custom hint');
  });

  it('§11 bootstrap 不含 AGENTS；toolSearch §8 为 catalog 非全文 XML', () => {
    const xml = '<skills><skill available="true"><name>demo</name><desc>' + 'x'.repeat(200) + '</desc></skill></skills>';
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: xml,
      activeSkillsContext: '<skill>full active xml</skill>',
      bootstrapContext: [
        '# Workspace',
        '',
        '## SOUL.md',
        '',
        'Soul persona',
        '',
        '## TOOLS.md',
        '',
        'Tool habits',
      ].join('\n'),
    });
    expect(prompt).toContain('## SOUL.md');
    expect(prompt).toContain('## TOOLS.md');
    expect(prompt).not.toContain('## AGENTS.md');
    expect(prompt).toContain('# Skills (catalog)');
    expect(prompt).toContain(' - demo:');
    expect(prompt).not.toContain('<skill available');
    expect(prompt).not.toContain('full active xml');
  });
});
