import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { moderationEngineToken } from '../../../../src/runtime.js';
import type { Action, MergedResult } from '../../../../src/types.js';

const inputSchema = z.object({
  text: z.string().min(1).max(2000).describe('Text to evaluate against content moderation policies'),
});

export default defineAgentTool({
  description: 'Evaluate sample text against content moderation policies without mutating state',
  inputSchema,
  readOnly: true,
  requiresApproval: 'never',
  async execute({ text }, context) {
    const engine = context.use(moderationEngineToken);
    const result: MergedResult & { readonly passed?: boolean; readonly actions?: readonly Action[] } =
      typeof engine.moderate === 'function'
        ? await engine.moderate({ text, direction: 'inbound' })
        : await engine.scan({
            text,
            images: [],
            direction: 'inbound',
            context: {
              adapter: 'agent',
              endpoint: 'tool',
              conversationKind: 'private',
              conversationId: 'moderation-check',
            },
          });

    const passed = result.passed ?? result.severity === 'pass';
    const actions = result.actions ?? engine.config?.actions?.[result.severity] ?? [];
    if (passed) {
      return `Moderation check passed (severity: ${result.severity}, actions: ${actions.join(', ') || 'allow'}). No rules matched.`;
    }
    const matchedWords = (result.matches ?? [])
      .map((match) => text.slice(match.start, match.end))
      .filter(Boolean);
    const matchesDetail = matchedWords.length > 0
      ? `matched: ${matchedWords.join(', ')}`
      : `matches: ${result.matches?.length ?? 0}`;
    const reasonSuffix = result.reason ? ` (${result.reason})` : '';
    return `Moderation check flagged (severity: ${result.severity}, ${matchesDetail}, actions: ${actions.join(', ') || 'none'})${reasonSuffix}.`;
  },
});
