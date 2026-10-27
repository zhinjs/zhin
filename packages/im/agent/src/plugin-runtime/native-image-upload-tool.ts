import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { defineAgentTool, toolFeatureId } from '@zhin.js/tool';
import type { ImageAssetPublisher } from '../media/image-assets.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';
import { authorizedAbsolutePath } from './native-file-tools.js';

/** File authority and public-publishing approval are enforced by the tool gateway. */
export function createNativeImageUploadToolFeature(imageAssets: ImageAssetPublisher) {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'upload_image',
    definition: defineAgentTool<Record<string, unknown>, string>({
      description: 'Publish a workspace PNG/JPEG/GIF/WebP image (up to 25 MiB) and return its public URL. Pass file_path, never base64. Anyone with the URL can read it until storage cleanup.',
      inputSchema: {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'Image file in the authorized workspace' } },
        required: ['file_path'],
      },
      requiresApproval: 'human',
      risk: 'dangerous',
      riskCategory: 'publish',
      async execute(input, context) {
        const filePath = authorizedAbsolutePath(input.file_path, context);
        context.signal.throwIfAborted();
        const chunks: Buffer[] = [];
        let size = 0;
        // Read one byte beyond the existing attachment limit to detect oversized files,
        // even if a file grows after authorization. No whole-file allocation before the limit.
        const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await file.stat();
          if (!stat.isFile()) throw new Error('Image upload requires a regular file');
          if (stat.size > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Image exceeds the 25 MiB attachment limit');
          const stream = file.createReadStream({
            end: DEFAULT_MULTIMODAL_CONFIG.maxFileBytes,
            signal: context.signal,
            autoClose: false,
          });
          for await (const chunk of stream) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Image exceeds the 25 MiB attachment limit');
            chunks.push(bytes);
          }
          return JSON.stringify(await imageAssets.publish(Buffer.concat(chunks, size), context.signal));
        } finally { await file.close(); }
      },
    }),
  });
}
