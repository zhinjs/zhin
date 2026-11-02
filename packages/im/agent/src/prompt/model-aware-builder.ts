import { REPLY_LANGUAGE_RULE } from './rules/reply-language.js';
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
          ' - Direct and concise — match reply length to question complexity',
          ' - Keep simple answers brief; add explanation or structure when useful',
          ' - No preamble ("Here\'s...", "I\'ll..."), no postamble ("Let me know...")',
          ' - Lead with the answer or result; explain when the request needs it',
          ` - ${REPLY_LANGUAGE_RULE}`,
        ].join('\n');
      case 'detailed':
        return [
          '# Style',
          ' - Lead with the answer or result',
          ' - Be concise, direct, and useful',
          ' - Use Markdown formatting when it improves clarity',
          ' - Match reply length to complexity; include the detail needed to understand multi-step results',
          ' - No preamble ("Here\'s...", "I\'ll..."), no postamble ("Let me know...")',
          ` - ${REPLY_LANGUAGE_RULE}`,
        ].join('\n');
      default:
        return [
          '# Style',
          ' - Lead with the answer or result',
          ' - Be concise, direct, and useful — match reply length to question complexity',
          ' - Use Markdown when helpful for structure',
          ' - No preamble ("Here\'s...", "I\'ll..."), no postamble ("Let me know...")',
          ` - ${REPLY_LANGUAGE_RULE}`,
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
