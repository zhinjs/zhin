import { defineAgentTool, toolFeatureId } from '@zhin.js/tool';
import type { LocalImageAssetStore } from '../media/local-image-assets.js';

export function createNativeLocalAssetsToolFeature(store: LocalImageAssetStore) {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'get_local_assets',
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description: 'Inspect a private MCP image by its asset_id from this conversation. Loads the image for the next model request, without publishing it. Original expires after 7 days. Never pass a filesystem path or base64.',
      inputSchema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'] },
      requiresApproval: 'never',
      async execute(input, context) {
        try { return await store.inspect(String(input.asset_id), context, context.signal); }
        catch {
          context.signal.throwIfAborted();
          throw new Error('Local image is unavailable, expired or outside this conversation');
        }
      },
    }),
  });
}
