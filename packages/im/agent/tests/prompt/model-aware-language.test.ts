import { CRITICAL_RULES } from '../../src/prompt/rules/critical-rules.js';
import { ModelAwarePromptBuilder } from '../../src/prompt/model-aware-builder.js';

it.each([
  ['claude-haiku', 'concise'], ['gpt-5', 'detailed'], ['gpt-4o', 'balanced'],
] as const)('keeps %s style static with user requests ahead of the locale fallback', (model, style) => {
  const builder = new ModelAwarePromptBuilder(model);
  expect(builder.strategy.style).toBe(style);
  const text = builder.buildStyleSection();
  expect(text).toContain('applicable explicit reply-language request first');
  expect(text).toContain('actual request, not framework notices');
  expect(text).toContain('If unclear, use Reply language fallback');
  expect(text).not.toContain('Use the runtime Reply language');
  expect(CRITICAL_RULES).not.toContain('reply-language');
  expect(text).not.toMatch(/Reply language: (?:en|zh-CN)/u);
});
