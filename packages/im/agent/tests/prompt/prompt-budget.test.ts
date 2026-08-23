import { describe, it, expect } from 'vitest';
import {
  buildRichSystemPrompt,
  enforcePromptBudget,
} from '../../src/prompt/system-prompt.js';
import { PromptBuilder } from '../../src/prompt/prompt-builder.js';
import { DEFAULT_CONFIG, SECTION_SEP } from '../../src/config/index.js';

describe('enforcePromptBudget', () => {
  it('未超预算：原样拼接', () => {
    const out = enforcePromptBudget([
      { content: 'aaa', retention: 'required', order: 100 },
      { content: 'bbb', retention: 'preferred', order: 50 },
    ], 1000);
    expect(out).toBe(['aaa', 'bbb'].join(SECTION_SEP));
  });

  it('空段与 null 被过滤', () => {
    const out = enforcePromptBudget([
      { content: null, retention: 'preferred', order: 20 },
      { content: '  ', retention: 'preferred', order: 10 },
      { content: 'aaa', retention: 'required', order: 100 },
    ], 1000);
    expect(out).toBe('aaa');
  });

  it('超预算：低 order 的 preferred 段先被尾部截断', () => {
    const system = 'S'.repeat(100);
    const skills = 'K'.repeat(100);
    const bootstrap = 'B'.repeat(100);
    // 总量 = 100 + 4 + 100 + 4 + 100 = 308；预算 250 → 先截 skills
    const out = enforcePromptBudget([
      { content: system, retention: 'required', order: 100 },
      { content: skills, retention: 'preferred', order: 10 },
      { content: bootstrap, retention: 'preferred', order: 20 },
    ], 250);
    expect(out).toContain('S'.repeat(100)); // 不可截断段完整保留
    expect(out).toContain('… (truncated)');
    expect(out).toContain('B'.repeat(100)); // bootstrap 未被波及
    expect(out.length).toBeLessThanOrEqual(250);
  });

  it('无法保留内容的可截断段被整段丢弃', () => {
    const system = 'S'.repeat(100);
    const out = enforcePromptBudget([
      { content: system, retention: 'required', order: 100 },
      { content: 'K'.repeat(100), retention: 'preferred', order: 10 },
    ], 120);
    // 120 预算连截断标记都放不下 → 整段丢弃
    expect(out).toBe(system);
  });

  it('maxChars <= 0 时不做截断', () => {
    const out = enforcePromptBudget([
      { content: 'K'.repeat(100), retention: 'preferred', order: 10 },
    ], 0);
    expect(out).toBe('K'.repeat(100));
  });
});

describe('buildRichSystemPrompt 总量护栏', () => {
  const hugeBootstrap = 'B'.repeat(50_000);

  it('默认预算下不截断', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: hugeBootstrap,
    });
    expect(prompt).toContain(hugeBootstrap);
  });

  it('超预算时可截断段被压缩，安全段保持完整', () => {
    const full = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: hugeBootstrap,
    });
    const capped = buildRichSystemPrompt({
      config: { ...DEFAULT_CONFIG, systemPromptMaxChars: 30_000 },
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: hugeBootstrap,
    });
    expect(capped.length).toBeLessThan(full.length);
    expect(capped).toContain('# Security');
    expect(capped).toContain('… (truncated)');
    expect(capped).not.toContain(hugeBootstrap); // bootstrap 被截断
    expect(capped.length).toBeLessThanOrEqual(30_000);
  });
});

describe('PromptBuilder 截断回归', () => {
  it('truncatable:false 段在超 maxTotalChars 时不被丢弃', () => {
    const builder = new PromptBuilder({ maxTotalChars: 500 });
    builder.addSystemPrompt('CORE-SYSTEM-RULES');
    builder.addCustomSection({
      title: 'Big',
      content: 'y'.repeat(2000),
      priority: 10,
      truncatable: true,
    });
    const out = builder.build();
    expect(out).toContain('CORE-SYSTEM-RULES');
  });
});
