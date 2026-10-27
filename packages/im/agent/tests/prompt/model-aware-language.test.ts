import { CRITICAL_RULES } from '../../src/prompt/rules/critical-rules.js';
import { ModelAwarePromptBuilder } from '../../src/prompt/model-aware-builder.js';

it.each([
  ['claude-haiku', 'concise'], ['gpt-5', 'detailed'], ['gpt-4o', 'balanced'],
] as const)('keeps %s style static with user requests ahead of the locale fallback', (model, style) => {
  const builder = new ModelAwarePromptBuilder(model);
  expect(builder.strategy.style).toBe(style);
  const text = builder.buildStyleSection();
  for (const policy of [text, CRITICAL_RULES]) {
    expect(policy).toContain('applicable explicit reply-language request first');
    expect(policy).toContain('actual request, not framework notices');
    expect(policy).toContain('If unclear, use Reply language fallback');
    expect(policy).not.toContain('Use the runtime Reply language');
  }
  expect(text).not.toMatch(/Reply language: (?:en|zh-CN)/u);
});
