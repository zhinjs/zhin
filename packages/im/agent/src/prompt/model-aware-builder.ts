import { type ModelPromptStrategy, resolveModelStrategy, DEFAULT_STRATEGY } from './model-prompt-strategy.js';

export class ModelAwarePromptBuilder {
  readonly strategy: ModelPromptStrategy;

  constructor(modelId?: string) {
    this.strategy = modelId ? resolveModelStrategy(modelId) : DEFAULT_STRATEGY;
  }

  buildStyleSection(): string {
    switch (this.strategy.style) {
      case 'concise':
        return [
          '# Style',
          ' - Be concise and direct',
          ' - One-word answers when possible',
          ' - No emojis, no preamble, no postamble',
          ' - Under 4 lines of text',
          ' - Focus on actions, not explanations',
        ].join('\n');
      case 'detailed':
        return [
          '# Style',
          ' - Lead with the answer or result',
          ' - Be concise, direct, and useful',
          ' - Use rich Markdown formatting (headings, bullet lists, tables) for multi-sentence answers',
          ' - Under 4 lines by default; up to 10-15 lines for large multi-file changes',
          ' - No emojis, no preamble, no postamble',
          ' - One-word answers when possible',
          ' - No explanations unless user asks',
        ].join('\n');
      default:
        return [
          '# Style',
          ' - Lead with the answer or result',
          ' - Be concise, direct, and useful',
          ' - Use Markdown when helpful',
          ' - Under 4 lines unless explaining complex changes',
          ' - No emojis, no preamble, no postamble',
        ].join('\n');
    }
  }

  buildContextModeHint(contextWindow: number): string | null {
    if (contextWindow >= 100000) {
      return [
        '# Long Context Mode',
        ' - You have a large context window. Use it wisely.',
        ' - Read entire files before editing when needed.',
        ' - You can process multiple files in parallel.',
        ' - Keep history context in mind when making decisions.',
      ].join('\n');
    }
    if (contextWindow <= 16000) {
      return [
        '# Short Context Mode',
        ' - Context is limited. Be efficient.',
        ' - Read only the sections you need using offset/limit.',
        ' - Avoid reading entire large files.',
        ' - Summarize rather than quote when possible.',
      ].join('\n');
    }
    return null;
  }
}
