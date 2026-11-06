import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { moderationEngineToken } from '../../../../src/runtime.js';

const inputSchema = z.object({});

export default defineAgentTool({
  description: 'Inspect content moderation engine status, active providers, sensitivity, and pending review count',
  inputSchema,
  readOnly: true,
  requiresApproval: 'never',
  async execute(_input, context) {
    const engine = context.use(moderationEngineToken);
    const config = engine.config;
    const enabled = Boolean(config?.enabled ?? true);
    const sensitivity = engine.sensitivity ?? (config?.onError === 'closed' ? 'strict' : 'medium');
    const providers = engine.providers?.map((p) => p.id)
      ?? config?.sources?.filter((s) => s.enabled).map((s) => s.id)
      ?? [];
    const pendingReviews = engine.pendingReviewsCount ?? engine.groupReviewQueue?.pendingCount ?? 0;

    return [
      `Moderation status: ${enabled ? 'enabled' : 'disabled'}`,
      `Sensitivity: ${sensitivity}`,
      `Providers (${providers.length}): ${providers.length > 0 ? providers.join(', ') : 'none'}`,
      `Pending group reviews: ${pendingReviews}`,
    ].join('\n');
  },
});
